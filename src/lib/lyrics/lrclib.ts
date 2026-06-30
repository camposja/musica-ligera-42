import { looselyMatches, lyricsMatchNorm } from "./normalize";
import type { LyricsLookup } from "./types";

// LRCLIB provider. Mirrors the iOS LRCLibProvider strategy: validated exact-ish
// /get first, then a conservative /search fallback, preferring "not found" over
// wrong lyrics. Only plainLyrics (unsynced) is used.

const BASE = "https://lrclib.net/api";
// LRCLIB asks clients to identify themselves. This repo sets no User-Agent
// anywhere else, so this is a new (acceptable) convention scoped to lyrics.
const USER_AGENT =
  "musica-ligera-web (https://github.com/camposja/musica-ligera-42)";

export class LrclibError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.name = "LrclibError";
    this.httpStatus = httpStatus;
  }
}

// Minimal shape of an LRCLIB track row. /get returns one; /search returns many.
type LrclibTrack = {
  trackName?: string | null;
  artistName?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean | null;
};

export function getURL(title: string, artist: string, album: string | null): string {
  const p = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album && album.trim().length > 0) p.set("album_name", album);
  return `${BASE}/get?${p.toString()}`;
}

export function searchURL(title: string, artist: string): string {
  const p = new URLSearchParams({ q: `${title} ${artist}` });
  return `${BASE}/search?${p.toString()}`;
}

async function readBodySafe(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

// GET wrapper: 404 -> null (no validated match; caller falls back / not_found);
// any other non-2xx -> throw LrclibError; 2xx -> parsed JSON.
async function lrclibGet<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await readBodySafe(res);
    console.error("[lrclib] upstream error", { url, status: res.status, body });
    throw new LrclibError(res.status, `LRCLIB API error: ${res.status}`);
  }
  return (await res.json()) as T;
}

// Map a track row to an outcome: non-empty plainLyrics -> found; explicit
// instrumental flag -> instrumental; otherwise not_found.
export function toLookup(track: LrclibTrack): LyricsLookup {
  const raw = track.plainLyrics ?? "";
  if (raw.trim().length > 0) return { kind: "found", lyrics: raw };
  if (track.instrumental === true) return { kind: "instrumental" };
  return { kind: "not_found" };
}

// Accept the FIRST search result whose normalized track AND artist both loosely
// match the request (and are non-empty). /get results are trusted (LRCLIB
// already matched on artist+title+album).
export function bestMatch(
  results: LrclibTrack[],
  title: string,
  artist: string,
): LrclibTrack | null {
  const wantT = lyricsMatchNorm(title);
  const wantA = lyricsMatchNorm(artist);
  for (const t of results) {
    const tn = lyricsMatchNorm(t.trackName ?? "");
    const an = lyricsMatchNorm(t.artistName ?? "");
    if (!tn || !an) continue;
    if (looselyMatches(tn, wantT) && looselyMatches(an, wantA)) return t;
  }
  return null;
}

export async function fetchLyrics(
  title: string,
  artist: string,
  album: string | null,
): Promise<LyricsLookup> {
  const direct = await lrclibGet<LrclibTrack>(getURL(title, artist, album));
  if (direct) return toLookup(direct);

  const results = await lrclibGet<LrclibTrack[]>(searchURL(title, artist));
  if (Array.isArray(results)) {
    const match = bestMatch(results, title, artist);
    if (match) return toLookup(match);
  }
  return { kind: "not_found" };
}
