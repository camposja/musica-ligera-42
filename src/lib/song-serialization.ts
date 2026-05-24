/**
 * Postgres stores `Song.youtubeAltIds` as a native `text[]`, so no JSON
 * parsing/serialization is needed. These helpers are kept (as pass-throughs)
 * so callers don't change between this branch and main — the wire contract
 * still exposes `youtubeAltIds: string[]`.
 */

/**
 * Identity transform on a Song row. Kept for call-site parity with main,
 * where it strips the SQLite-only `youtubeAltIdsJson` column.
 */
export function normalizeSong<T extends { youtubeAltIds: string[] }>(song: T): T {
  return song;
}

/**
 * Identity transform on a Playlist-with-songs row. Same rationale as
 * `normalizeSong`.
 */
export function normalizePlaylistWithSongs<
  TSong extends { youtubeAltIds: string[] },
  TPS extends { song: TSong },
  TPlaylist extends { songs: TPS[] },
>(playlist: TPlaylist): TPlaylist {
  return playlist;
}
