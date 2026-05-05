import { prisma } from "@/lib/prisma";

export type YoutubeMatch = {
  best: string;
  alternates: string[];
};

export class YoutubeError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "YoutubeError";
  }
}

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new YoutubeError(0, "YouTube not configured: YOUTUBE_API_KEY must be set");
  }
  return key;
}

export function isValidYoutubeId(id: string): boolean {
  return typeof id === "string" && VIDEO_ID_RE.test(id);
}

type SearchItem = { id?: { videoId?: string } | string };
type SearchResponse = { items?: SearchItem[] };

type VideoStatusItem = {
  id: string;
  status?: { embeddable?: boolean; privacyStatus?: string };
  contentDetails?: { contentRating?: { ytRating?: string } };
};
type VideosResponse = { items?: VideoStatusItem[] };

/**
 * Returns the subset of `ids` that play **without requiring a YouTube
 * sign-in**. Filters out:
 *   - non-embeddable videos (status.embeddable === false): label-uploaded
 *     music videos often disable third-party embeds entirely.
 *   - age-restricted videos (contentDetails.contentRating.ytRating ===
 *     "ytAgeRestricted"): these technically embed but YouTube blocks
 *     playback for signed-out viewers, showing "Sign in to confirm your
 *     age" — the most common reason a "match" looks broken to users.
 *   - private videos.
 *
 * Costs 2 quota units per call (1 per `part`). Batches up to 50 IDs.
 *
 * On YouTube API failure, returns the input unchanged — we'd rather risk a
 * non-playable match than silently drop everything.
 */
export async function filterEmbeddableIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const key = getApiKey();
  const url = `${VIDEOS_URL}?part=status,contentDetails&id=${ids.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error("[youtube] embeddability check fetch failed", { err });
    return ids;
  }
  if (!res.ok) {
    console.error("[youtube] embeddability check non-OK", { status: res.status });
    return ids;
  }
  const json = (await res.json()) as VideosResponse;
  const ok = new Set<string>();
  for (const item of json.items ?? []) {
    const embeddable = item.status?.embeddable === true;
    const notPrivate = item.status?.privacyStatus !== "private";
    const ageRestricted =
      item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted";
    if (embeddable && notPrivate && !ageRestricted) {
      ok.add(item.id);
    }
  }
  return ids.filter((id) => ok.has(id));
}

export async function searchVideo(query: string): Promise<YoutubeMatch> {
  const key = getApiKey();
  const url = `${SEARCH_URL}?part=snippet&type=video&maxResults=4&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
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
    // Google returns 403 for both quota-exceeded and invalid-key cases.
    throw new YoutubeError(403, "YouTube 403 (quota exceeded or invalid key)");
  }
  if (!res.ok) {
    throw new YoutubeError(res.status, `YouTube API error: ${res.status}`);
  }

  const json = (await res.json()) as SearchResponse;
  const items = json.items ?? [];
  const ids: string[] = [];
  for (const it of items) {
    const vid =
      typeof it.id === "string" ? it.id : (it.id as { videoId?: string } | undefined)?.videoId;
    if (vid && isValidYoutubeId(vid)) ids.push(vid);
  }
  if (ids.length === 0) {
    throw new YoutubeError(404, "No YouTube match found");
  }
  // Filter to embeddable picks only (most label-uploaded music videos disable
  // third-party embedding; without this filter we end up with "Video unavailable
  // — watch on YouTube" iframes for popular tracks). If the upstream check
  // fails or every result is non-embeddable, fall back to the original order.
  const embeddable = await filterEmbeddableIds(ids);
  const ordered = embeddable.length > 0 ? embeddable : ids;
  return { best: ordered[0], alternates: ordered.slice(1, 4) };
}

/**
 * For an already-matched song, re-check whether its current `youtubeId` is
 * still embeddable. If not, promote the first embeddable entry from
 * `youtubeAltIds` (if any) to `youtubeId`. Returns whether a swap happened.
 *
 * This is the cheap fix for songs matched BEFORE the embeddability filter
 * existed — uses 1 quota unit per song instead of 100 (no new search call).
 */
export async function refilterSongMatch(
  songId: string,
): Promise<{ changed: boolean; nowUnplayable: boolean }> {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song || !song.youtubeId) return { changed: false, nowUnplayable: false };

  const candidates = [song.youtubeId, ...song.youtubeAltIds].filter(
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
    data: { youtubeId: newBest, youtubeAltIds: newAlts },
  });
  return { changed: true, nowUnplayable: false };
}

export async function matchSongById(
  songId: string,
  opts?: { force?: boolean },
): Promise<void> {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song) return;
  if (!opts?.force && song.youtubeId) return;

  const query = `${song.artist} ${song.title}`.trim();
  const match = await searchVideo(query);

  await prisma.song.update({
    where: { id: songId },
    data: { youtubeId: match.best, youtubeAltIds: match.alternates },
  });
}

// === Background trigger (concurrency 1, errors swallowed) ==================

let chain: Promise<void> = Promise.resolve();

/**
 * Fire-and-forget background match. Serializes via a single chained promise
 * (concurrency 1) so we never fan out N parallel YouTube requests.
 *
 * Errors are unconditionally caught and logged — a quota / network / no-result
 * failure here must NEVER reject up the chain (which would crash the worker)
 * or bubble into the original API response.
 *
 * MVP/local-server only: in serverless deployments the worker is killed after
 * the response is sent, so this work would be aborted. Replace with a durable
 * queue before any serverless deploy.
 */
export function triggerMatchInBackground(songId: string): void {
  chain = chain.then(() =>
    matchSongById(songId).catch((err: unknown) => {
      console.error("[youtube] background match failed", { songId, err });
    }),
  );
}

/**
 * TEST-ONLY. Awaits the current background-match chain so tests can
 * deterministically assert state after auto-match has settled. Route handler
 * code must NEVER call this; it would block requests on unrelated work.
 */
export async function flushPendingMatches(): Promise<void> {
  await chain;
}

/**
 * TEST-ONLY. Resets the internal background chain. Useful in test setup
 * to make sure leftover work from a prior test doesn't bleed through.
 */
export function _resetMatchChainForTests(): void {
  chain = Promise.resolve();
}
