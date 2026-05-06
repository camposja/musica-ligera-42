/**
 * SQLite has no array column type. The `Song.youtubeAltIdsJson` field stores
 * a JSON-encoded `string[]`, and helpers below paper over the difference so
 * the rest of the app and the wire contract still see `youtubeAltIds: string[]`.
 *
 * Convention: never expose `youtubeAltIdsJson` in API responses. Every
 * `Response.json` site that includes a Song row should pass it through
 * `normalizeSong` first.
 */

export function parseAltIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function serializeAltIds(arr: string[]): string {
  return JSON.stringify(arr);
}

/**
 * Strip `youtubeAltIdsJson` from a Song row and replace it with the parsed
 * `youtubeAltIds: string[]` shape. Generic so it works on rows with extra
 * fields (e.g. nested includes).
 */
export function normalizeSong<T extends { youtubeAltIdsJson: string }>(
  song: T,
): Omit<T, "youtubeAltIdsJson"> & { youtubeAltIds: string[] } {
  const { youtubeAltIdsJson, ...rest } = song;
  return { ...rest, youtubeAltIds: parseAltIds(youtubeAltIdsJson) };
}

/**
 * Normalize a playlist row whose `songs` include the raw Song shape with
 * `youtubeAltIdsJson`. Used by the playlist GET endpoint and any place that
 * returns a playlist with its songs nested.
 */
export function normalizePlaylistWithSongs<
  TSong extends { youtubeAltIdsJson: string },
  TPS extends { song: TSong },
  TPlaylist extends { songs: TPS[] },
>(
  playlist: TPlaylist,
): Omit<TPlaylist, "songs"> & {
  songs: Array<Omit<TPS, "song"> & { song: ReturnType<typeof normalizeSong<TSong>> }>;
} {
  return {
    ...playlist,
    songs: playlist.songs.map((ps) => ({ ...ps, song: normalizeSong(ps.song) })),
  };
}
