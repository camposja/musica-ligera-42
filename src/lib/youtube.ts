import { prisma } from "@/lib/prisma";
import { parseAltIds, serializeAltIds } from "@/lib/song-serialization";
import { isValidYoutubeId, YOUTUBE_ID_RE } from "@/lib/youtube-id";
import {
  checkQuota,
  consumeQuota,
  markQuotaExhausted,
  SEARCH_UNIT_COST,
} from "@/lib/youtube-quota";
import {
  pickBestMatch,
  type Candidate,
  type MatchResult,
} from "@/lib/youtube-match";

export { isValidYoutubeId };

export class YoutubeError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly retryAfterSeconds?: number,
    // YouTube Data API error reason from `error.errors[0].reason`. Lets callers
    // tell `quotaExceeded` apart from `keyInvalid` / `accessNotConfigured` so
    // a misconfigured key doesn't get treated as quota exhaustion and lock the
    // ledger for the rest of the day.
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "YoutubeError";
  }
}

// Quota exhaustion reasons from the YouTube Data API. `quotaExceeded` and
// `dailyLimitExceeded` mean "you're done for the day, lock the ledger". Other
// 403 reasons (keyInvalid, accessNotConfigured, referrerNotAllowed) are
// configuration/auth problems — surface them but don't lock. Rate-limit reasons
// (rateLimitExceeded, userRateLimitExceeded) are transient and shouldn't lock
// either.
const QUOTA_LOCK_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

export function isQuotaExhaustionReason(reason: string | undefined): boolean {
  return reason !== undefined && QUOTA_LOCK_REASONS.has(reason);
}

// Parse a YouTube Data API error response and pluck `error.errors[0].reason`.
// Uses res.clone() so the caller can still read the body if it wants. Returns
// undefined for any parse failure or unexpected shape.
export async function parseYoutubeErrorReason(
  res: Response,
): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    const reason = body.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : undefined;
  } catch {
    return undefined;
  }
}

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const VIDEO_ID_RE = YOUTUBE_ID_RE;
const SEARCH_LIMIT = 10;

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new YoutubeError(0, "YouTube not configured: YOUTUBE_API_KEY must be set");
  }
  return key;
}

/**
 * Parse a user-pasted YouTube reference into a clean 11-char video ID.
 * Returns null for anything that isn't a recognizable video URL/ID.
 *
 * Accepts:
 *   - raw 11-char ID: "dQw4w9WgXcQ"
 *   - watch URLs: youtube.com / m.youtube.com / music.youtube.com / www.
 *   - youtu.be short links
 *   - embed/v paths
 *   - extra query params (&list=, &t=, &si=) — ignored
 *   - surrounding whitespace and quotes (paste artifacts)
 *
 * Rejects (returns null):
 *   - youtube.com/shorts/<id>  — Shorts are usually not full songs
 *   - channel/playlist-only URLs with no video id
 *   - non-YouTube hosts
 */
export function parseYoutubeRef(input: string): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^["']|["']$/g, "");
  if (s.length === 0) return null;

  // Bare ID (11 chars, no slashes/dots)
  if (VIDEO_ID_RE.test(s)) return s;

  // Add a scheme so URL parses bare hosts ("youtu.be/abc")
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;

  if (host === "youtu.be") {
    // youtu.be/<id>
    const id = path.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    // Reject Shorts explicitly — different surface, often not the song.
    if (path.startsWith("/shorts/")) return null;
    if (path === "/watch") {
      const v = url.searchParams.get("v");
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    // /embed/<id> or /v/<id>
    const m = /^\/(?:embed|v)\/([A-Za-z0-9_-]{11})/.exec(path);
    if (m) return m[1];
    return null;
  }

  return null;
}

type SearchItem = { id?: { videoId?: string } | string };
type SearchResponse = { items?: SearchItem[] };

type ThumbnailEntry = { url?: string };
type VideoDetailsItem = {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      default?: ThumbnailEntry;
      medium?: ThumbnailEntry;
      high?: ThumbnailEntry;
    };
  };
  status?: { embeddable?: boolean; privacyStatus?: string };
  contentDetails?: {
    duration?: string;
    contentRating?: { ytRating?: string };
  };
};
type VideosResponse = { items?: VideoDetailsItem[] };

export type VideoDetails = {
  id: string;
  title: string;
  channel: string;
  embeddable: boolean;
  ageRestricted: boolean;
  isPrivate: boolean;
  durationSec: number;
  thumbnailUrl: string | null;
};

// Parse ISO 8601 duration like PT3M42S into seconds.
function parseIsoDuration(s: string | undefined): number {
  if (!s) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return 0;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const sec = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + sec;
}

/**
 * Fetch full per-video details for up to 50 IDs in one /videos call.
 * Costs 3 quota units (1 per `part`). Returns a Map keyed by id.
 */
export async function fetchVideoDetails(
  ids: string[],
): Promise<Map<string, VideoDetails>> {
  const out = new Map<string, VideoDetails>();
  if (ids.length === 0) return out;
  const key = getApiKey();
  const url = `${VIDEOS_URL}?part=snippet,status,contentDetails&id=${ids
    .map(encodeURIComponent)
    .join(",")}&key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error("[youtube] videos.list fetch failed", { err });
    return out;
  }
  if (!res.ok) {
    console.error("[youtube] videos.list non-OK", { status: res.status });
    return out;
  }
  const json = (await res.json()) as VideosResponse;
  for (const item of json.items ?? []) {
    const thumbs = item.snippet?.thumbnails;
    // Prefer medium (320x180) — better for list rows; fall back to default.
    const thumbnailUrl =
      thumbs?.medium?.url ?? thumbs?.default?.url ?? null;
    out.set(item.id, {
      id: item.id,
      title: item.snippet?.title ?? "",
      channel: item.snippet?.channelTitle ?? "",
      embeddable: item.status?.embeddable === true,
      ageRestricted:
        item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted",
      isPrivate: item.status?.privacyStatus === "private",
      durationSec: parseIsoDuration(item.contentDetails?.duration),
      thumbnailUrl,
    });
  }
  return out;
}

/**
 * Backwards-compatible: returns the subset of `ids` that play without a
 * YouTube sign-in. Used by `refilterSongMatch`.
 *
 * On YouTube API failure, returns the input unchanged — better to risk a
 * non-playable match than silently drop everything.
 */
export async function filterEmbeddableIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const details = await fetchVideoDetails(ids);
  if (details.size === 0) return ids;
  return ids.filter((id) => {
    const d = details.get(id);
    if (!d) return false;
    return d.embeddable && !d.ageRestricted && !d.isPrivate;
  });
}

/**
 * Search YouTube for `query`, fetch full details for up to 10 candidates,
 * and return them in YouTube's relevance order. Caller (the matcher) is
 * responsible for scoring + picking the best one.
 *
 * Quota: search.list = 100 units, videos.list = 3 units → 103 units per call
 * (was 102 with the old embeddability-only path; +1 for snippet).
 */
export async function searchCandidates(query: string): Promise<Candidate[]> {
  const key = getApiKey();
  const url = `${SEARCH_URL}?part=snippet&type=video&maxResults=${SEARCH_LIMIT}&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);

  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    throw new YoutubeError(
      429,
      "YouTube rate limit",
      retry ? Number(retry) : undefined,
    );
  }
  if (res.status === 403) {
    const reason = await parseYoutubeErrorReason(res);
    throw new YoutubeError(
      403,
      reason ? `YouTube 403 (${reason})` : "YouTube 403 (no reason)",
      undefined,
      reason,
    );
  }
  if (!res.ok) {
    throw new YoutubeError(res.status, `YouTube API error: ${res.status}`);
  }

  const json = (await res.json()) as SearchResponse;
  const items = json.items ?? [];
  const ids: string[] = [];
  for (const it of items) {
    const vid =
      typeof it.id === "string"
        ? it.id
        : (it.id as { videoId?: string } | undefined)?.videoId;
    if (vid && isValidYoutubeId(vid)) ids.push(vid);
  }
  if (ids.length === 0) return [];

  const details = await fetchVideoDetails(ids);
  const candidates: Candidate[] = [];
  for (const id of ids) {
    const d = details.get(id);
    if (!d) continue;
    // Skip private — those literally cannot be played even by yt-dlp.
    // Keep non-embeddable + age-restricted: yt-dlp can play them; the
    // iframe fallback is the only thing they break.
    if (d.isPrivate) continue;
    candidates.push({
      id: d.id,
      title: d.title,
      channel: d.channel,
      durationSec: d.durationSec,
    });
  }
  return candidates;
}

/**
 * For an already-matched song, re-check whether its current `youtubeId` is
 * still embeddable. If not, promote the first embeddable entry from
 * `youtubeAltIds` (if any) to `youtubeId`. Returns whether a swap happened.
 *
 * Less critical now that yt-dlp playback works: this only matters if the
 * user explicitly clicks "Try YouTube embed" (the manual iframe fallback).
 */
export async function refilterSongMatch(
  songId: string,
): Promise<{ changed: boolean; nowUnplayable: boolean }> {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song || !song.youtubeId) return { changed: false, nowUnplayable: false };

  const candidates = [song.youtubeId, ...parseAltIds(song.youtubeAltIdsJson)].filter(
    isValidYoutubeId,
  );
  if (candidates.length === 0) return { changed: false, nowUnplayable: true };

  const embeddable = await filterEmbeddableIds(candidates);
  if (embeddable.length === 0) {
    return { changed: false, nowUnplayable: true };
  }
  if (embeddable[0] === song.youtubeId) {
    return { changed: false, nowUnplayable: false };
  }
  const newBest = embeddable[0];
  const newAlts = embeddable.slice(1);
  await prisma.song.update({
    where: { id: songId },
    data: { youtubeId: newBest, youtubeAltIdsJson: serializeAltIds(newAlts) },
  });
  return { changed: true, nowUnplayable: false };
}

export type MatchOutcome =
  | { matched: true; type: "exact" | "loose"; result: MatchResult }
  | { matched: false };

export async function matchSongById(
  songId: string,
  opts?: { force?: boolean },
): Promise<MatchOutcome> {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song) return { matched: false };
  if (!opts?.force && song.youtubeId) return { matched: false };

  // Daily-quota gate. Charge BEFORE the call; on Google 403 mark exhausted
  // so the rest of the day's calls fail fast instead of also paying 403s.
  const check = await checkQuota(SEARCH_UNIT_COST);
  if (!check.ok) {
    throw new YoutubeError(429, "youtube_quota_safeguard");
  }
  await consumeQuota(SEARCH_UNIT_COST);

  const query = `${song.artist} ${song.title}`.trim();
  let candidates: Candidate[];
  try {
    candidates = await searchCandidates(query);
  } catch (err) {
    if (
      err instanceof YoutubeError &&
      err.httpStatus === 403 &&
      isQuotaExhaustionReason(err.reason)
    ) {
      // Real quota wall — lock out the rest of the day so we don't keep
      // burning 403s. Non-quota 403s (keyInvalid, accessNotConfigured) fall
      // through and just propagate the error to the caller.
      await markQuotaExhausted();
    }
    throw err;
  }
  if (candidates.length === 0) {
    throw new YoutubeError(404, "No YouTube match found");
  }
  const match = pickBestMatch({ title: song.title, artist: song.artist }, candidates);
  if (!match) {
    throw new YoutubeError(404, "No YouTube match cleared the loose threshold");
  }

  await prisma.song.update({
    where: { id: songId },
    data: {
      youtubeId: match.best,
      youtubeAltIdsJson: serializeAltIds(match.alternates),
      youtubeMatchType: match.type,
      youtubeMatchReason: match.reason,
      youtubeMatchTitle: match.title,
      youtubeMatchChannel: match.channel,
    },
  });

  return { matched: true, type: match.type, result: match };
}

// === Background trigger (concurrency 1, errors swallowed) ==================

let chain: Promise<void> = Promise.resolve();

/**
 * Fire-and-forget background match. Serializes via a single chained promise
 * (concurrency 1) so we never fan out N parallel YouTube requests.
 *
 * Errors are unconditionally caught and logged.
 */
export function triggerMatchInBackground(songId: string): void {
  chain = chain.then(() =>
    matchSongById(songId)
      .then(() => {})
      .catch((err: unknown) => {
        console.error("[youtube] background match failed", { songId, err });
      }),
  );
}

/** TEST-ONLY. Awaits the current background-match chain. */
export async function flushPendingMatches(): Promise<void> {
  await chain;
}

/** TEST-ONLY. Resets the internal background chain. */
export function _resetMatchChainForTests(): void {
  chain = Promise.resolve();
}
