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
  return { best: ids[0], alternates: ids.slice(1, 4) };
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
