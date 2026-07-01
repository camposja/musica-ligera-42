import { effectiveUserId, forbidden, getSession, unauthorized } from "@/lib/auth";
import { rankPlaylists, rankSongs } from "@/lib/library-search";
import { prisma } from "@/lib/prisma";
import { normalizeSong } from "@/lib/song-serialization";
import type {
  LibraryPlaylistRef,
  LibrarySearchResponse,
  LibrarySearchResult,
} from "@/types/api";

// GET /api/library/search?q=<query>
// Searches the effective user's saved library — the playlists they own and the
// songs in them. Songs are global rows (no userId), so scope is enforced through
// Playlist.userId → PlaylistSong → Song; a user never sees another user's songs.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  const q = new URL(request.url).searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json({ error: "q required" }, { status: 400 });
  }
  const query = q.trim();

  const [songRows, playlistRows] = await Promise.all([
    prisma.song.findMany({
      where: { playlistSongs: { some: { playlist: { userId: eid } } } },
      include: {
        playlistSongs: {
          where: { playlist: { userId: eid } },
          select: { playlist: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.playlist.findMany({
      where: { userId: eid },
      select: { id: true, name: true },
    }),
  ]);

  // Shape songs into wire results: strip the join relation and expose which of
  // the user's playlists contain each song (deduped) for linking.
  const songs: LibrarySearchResult[] = songRows.map((row) => {
    const { playlistSongs, ...songRow } = row;
    const seen = new Map<string, LibraryPlaylistRef>();
    for (const ps of playlistSongs) {
      seen.set(ps.playlist.id, { id: ps.playlist.id, name: ps.playlist.name });
    }
    return { ...normalizeSong(songRow), playlists: [...seen.values()] };
  });

  const body: LibrarySearchResponse = {
    songs: rankSongs(query, songs),
    playlists: rankPlaylists(query, playlistRows),
  };
  return Response.json(body);
}
