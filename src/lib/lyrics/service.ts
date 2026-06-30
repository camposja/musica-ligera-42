import { lookup, record } from "./cache";
import { fetchLyrics } from "./lrclib";
import { lyricsKey } from "./normalize";
import type { LyricsLookup, LyricsResponse } from "./types";

type SongLike = { title: string; artist: string; album: string | null };

function toResponse(result: LyricsLookup): LyricsResponse {
  if (result.kind === "found") return { state: "found", lyrics: result.lyrics };
  if (result.kind === "instrumental") return { state: "instrumental" };
  return { state: "not_found" };
}

// Cache-first lyrics lookup. A fresh cache hit never touches LRCLIB. A provider
// transport failure maps to the generic `error` state (the detail is logged, not
// exposed). Both hits and misses are cached.
export async function getLyrics(song: SongLike): Promise<LyricsResponse> {
  const key = lyricsKey(song.artist, song.title);

  const cached = await lookup(key).catch(() => null);
  if (cached) return toResponse(cached);

  let result: LyricsLookup;
  try {
    result = await fetchLyrics(song.title, song.artist, song.album);
  } catch (err) {
    console.error("[lyrics] fetch failed", { key, err });
    return { state: "error", error: "Couldn't load lyrics." };
  }

  await record(key, result).catch((err) => {
    console.error("[lyrics] cache write failed", { key, err });
  });
  return toResponse(result);
}
