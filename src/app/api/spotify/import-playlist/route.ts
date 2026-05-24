import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseSpotifyPlaylistId,
  SpotifyError,
  type NormalizedTrack,
} from "@/lib/spotify";
import { getPlaylistFromEmbed, PlaylistNotVisibleError } from "@/lib/spotify-embed";
import { triggerMatchInBackground } from "@/lib/youtube";

// How many newly-imported (unmatched) songs auto-match in the background per
// import. Each match costs ~103 quota units, so this caps quota burn per
// import. 10 is a balance between coverage and budget; bump
// SPOTIFY_IMPORT_AUTO_MATCH_LIMIT in the environment to tune for a particular
// import. The remaining unmatched rows wait for "Pick YT match" or a manual
// link override.
function importAutoMatchLimit(): number {
  const v = Number(process.env.SPOTIFY_IMPORT_AUTO_MATCH_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const url = (body as Record<string, unknown>).url;
  if (typeof url !== "string" || url.length === 0) {
    return Response.json({ error: "url required" }, { status: 400 });
  }
  const playlistId = parseSpotifyPlaylistId(url);
  if (!playlistId) {
    return Response.json({ error: "Invalid Spotify playlist URL" }, { status: 400 });
  }

  // Spotify Web API blocks /playlists/{id}/tracks for Dev-Mode apps (Nov 2024
  // policy), so we scrape the public embed iframe instead. See spotify-embed.ts.
  let playlistName: string;
  let allTracks: NormalizedTrack[];
  try {
    const { name, tracks } = await getPlaylistFromEmbed(playlistId);
    playlistName = name && name.length > 0 ? name : "Imported Spotify Playlist";
    allTracks = tracks;
  } catch (err) {
    return spotifyErrorResponse(err);
  }

  // Dedupe by spotifyId, preserving first-occurrence order.
  const seen = new Set<string>();
  const uniqueTracks: NormalizedTrack[] = [];
  for (const t of allTracks) {
    if (seen.has(t.spotifyId)) continue;
    seen.add(t.spotifyId);
    uniqueTracks.push(t);
  }

  // === Step 4: Count imported vs reused BEFORE writing ===
  const incomingSpotifyIds = uniqueTracks.map((t) => t.spotifyId);
  const existing = incomingSpotifyIds.length
    ? await prisma.song.findMany({
        where: { spotifyId: { in: incomingSpotifyIds } },
        select: { spotifyId: true },
      })
    : [];
  const existingSet = new Set(existing.map((e) => e.spotifyId));
  const songsReused = existingSet.size;
  const songsImported = incomingSpotifyIds.length - songsReused;

  // === Step 5: Open a short transaction for DB writes only ===
  const songIdByTrack = new Map<string, string>();
  const playlist = await prisma.$transaction(async (tx) => {
    for (const t of uniqueTracks) {
      const song = await tx.song.upsert({
        where: { spotifyId: t.spotifyId },
        update: {},
        create: {
          title: t.title,
          artist: t.artist,
          album: t.album ?? undefined,
          spotifyId: t.spotifyId,
        },
      });
      songIdByTrack.set(t.spotifyId, song.id);
    }
    const created = await tx.playlist.create({
      data: {
        name: playlistName,
        userId: eid,
        source: "SPOTIFY_IMPORT",
        locked: true,
        importedAt: new Date(),
        sourceLabel: "Spotify import",
      },
    });
    if (uniqueTracks.length > 0) {
      await tx.playlistSong.createMany({
        data: uniqueTracks.map((t, idx) => ({
          playlistId: created.id,
          songId: songIdByTrack.get(t.spotifyId)!,
          order: idx,
        })),
      });
    }
    return created;
  });

  // Fire-and-forget auto-match for songs that don't have a youtubeId yet.
  if (uniqueTracks.length > 0) {
    const allSongIds = Array.from(songIdByTrack.values());
    const needsMatch = await prisma.song.findMany({
      where: { id: { in: allSongIds }, youtubeId: null },
      select: { id: true },
      take: importAutoMatchLimit(),
    });
    for (const { id } of needsMatch) {
      triggerMatchInBackground(id);
    }
  }

  return Response.json(
    {
      playlist: { id: playlist.id, name: playlist.name },
      songsImported,
      songsReused,
    },
    { status: 201 },
  );
}

function spotifyErrorResponse(err: unknown): Response {
  if (err instanceof PlaylistNotVisibleError) {
    return Response.json(
      {
        error:
          "Spotify isn't sharing this playlist publicly. It may be private, region-locked, or recently deleted.",
        code: "playlist_not_visible_or_private",
      },
      { status: 404 },
    );
  }
  if (err instanceof SpotifyError) {
    if (err.httpStatus === 404) {
      return Response.json(
        {
          error:
            "Playlist not found or not visible to the connected Spotify account",
          code: "playlist_not_found_or_private",
        },
        { status: 404 },
      );
    }
    if (err.httpStatus === 403) {
      return Response.json(
        {
          error:
            "Spotify restricts this playlist (e.g. editorial / algorithmic) for app access",
          code: "spotify_restricted",
        },
        { status: 403 },
      );
    }
    if (err.httpStatus === 429) {
      const headers = new Headers({ "content-type": "application/json" });
      if (err.retryAfterSeconds !== undefined) {
        headers.set("retry-after", String(err.retryAfterSeconds));
      }
      return new Response(
        JSON.stringify({
          error: "Spotify rate limit",
          code: "rate_limited",
          retryAfterSeconds: err.retryAfterSeconds ?? null,
        }),
        { status: 503, headers },
      );
    }
    if (err.httpStatus === 0) {
      return Response.json(
        { error: err.message, code: "upstream" },
        { status: 502 },
      );
    }
    return Response.json(
      {
        error: "Spotify upstream error",
        code: "upstream",
        upstreamStatus: err.httpStatus,
      },
      { status: 502 },
    );
  }
  throw err;
}
