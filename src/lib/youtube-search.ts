/**
 * User-facing YouTube search helper. Wraps the matcher's `searchCandidates`
 * pipeline with a richer output shape (adds thumbnail + canonical URL) for
 * `/api/youtube/search` and the result-row UI.
 *
 * Quota accounting is the route's responsibility (see `src/lib/youtube-quota.ts`)
 * — this module just speaks to YouTube and shapes the result.
 */

import {
  fetchVideoDetails,
  isValidYoutubeId,
  parseYoutubeErrorReason,
  YoutubeError,
} from "@/lib/youtube";
import {
  cacheLookup,
  cacheStore,
} from "@/lib/youtube-search-cache";
import {
  checkQuota,
  consumeQuota,
  SEARCH_UNIT_COST,
} from "@/lib/youtube-quota";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const SEARCH_LIMIT = 10;

export type YoutubeSearchResult = {
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  url: string;
  thumbnailUrl: string | null;
};

type SearchItem = { id?: { videoId?: string } | string };
type RawSearchResponse = { items?: SearchItem[] };

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new YoutubeError(0, "YouTube not configured: YOUTUBE_API_KEY must be set");
  }
  return key;
}

/**
 * Search YouTube + fetch details + return ready-to-render results in
 * YouTube's relevance order. Filters out private videos. Keeps non-embeddable
 * + age-restricted entries — yt-dlp/Piped can play them; only the iframe
 * fallback breaks.
 *
 * Cache-aware: when `opts.noCache` is falsy, a same-day cache hit returns
 * immediately and does NOT charge the quota ledger. Cache misses run the
 * standard gate (check → consume → fetch → store).
 *
 * Quota cost on cache miss: ~103 units (search.list 100 + videos.list 3).
 *
 * Throws `YoutubeError(429, "youtube_quota_safeguard")` if the daily safety
 * cap would be exceeded by this call. The route layer maps that to the
 * existing 429 + `code: youtube_quota_safeguard` response shape.
 */
export async function searchYoutube(
  query: string,
  opts: { noCache?: boolean } = {},
): Promise<YoutubeSearchResult[]> {
  // Cache hit short-circuits the entire quota gate. Same UTC day, same
  // normalized query → reuse the previous payload at no quota cost.
  if (!opts.noCache) {
    const cached = await cacheLookup(query);
    if (cached) return cached;
  }

  // Cache miss: enforce the daily safety cap before charging.
  const check = await checkQuota(SEARCH_UNIT_COST);
  if (!check.ok) {
    throw new YoutubeError(429, "youtube_quota_safeguard");
  }
  await consumeQuota(SEARCH_UNIT_COST);

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

  const json = (await res.json()) as RawSearchResponse;
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
  const out: YoutubeSearchResult[] = [];
  for (const id of ids) {
    const d = details.get(id);
    if (!d) continue;
    if (d.isPrivate) continue;
    out.push({
      youtubeId: d.id,
      title: d.title,
      channel: d.channel,
      durationSec: d.durationSec,
      url: `https://www.youtube.com/watch?v=${d.id}`,
      thumbnailUrl: d.thumbnailUrl,
    });
  }

  // Store on success. cacheStore swallows empty-result writes and runs GC.
  await cacheStore(query, out);
  return out;
}

/**
 * Parse a YouTube `(title, channel)` pair into a saner `(title, artist)`
 * pair for storage as a Song row. Two cases handled:
 *
 *   1. Title contains "Artist - Song" (with -, –, or — as separator) →
 *      split on the FIRST separator: artist=left, title=right.
 *   2. Title has no separator → keep title as-is, use the cleaned channel
 *      name as artist.
 *
 * Channel cleanup strips the auto-generated " - Topic" suffix and the
 * trailing "VEVO" suffix that YouTube/labels add to canonical artist
 * channels (e.g. "Adele - Topic" → "Adele", "AdeleVEVO" → "Adele").
 */
export function parseYoutubeMetadata(
  rawTitle: string,
  rawChannel: string,
): { title: string; artist: string } {
  const channel = cleanChannel(rawChannel);
  const t = rawTitle.trim();
  // Use FIRST separator (some live-version titles have multiple hyphens).
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (m) {
    return { artist: m[1].trim(), title: m[2].trim() };
  }
  return { title: t, artist: channel };
}

function cleanChannel(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/VEVO\s*$/i, "")
    .trim();
}
