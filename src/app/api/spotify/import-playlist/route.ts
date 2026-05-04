import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAllPlaylistTracks,
  getPlaylist,
  parseSpotifyPlaylistId,
  SpotifyError,
  type NormalizedTrack,
} from "@/lib/spotify";

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

  // === Step 1-3: All Spotify HTTP fetches happen OUTSIDE any DB transaction ===
  let playlistName: string;
  let allTracks: NormalizedTrack[];
  try {
    const meta = await getPlaylist(playlistId);
    playlistName = meta.name && meta.name.length > 0 ? meta.name : "Imported Spotify Playlist";
    allTracks = await getAllPlaylistTracks(playlistId);
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
  const playlist = await prisma.$transaction(async (tx) => {
    // Upsert each Song by spotifyId; preserve local rows on conflict.
    const songIdByTrack = new Map<string, string>();
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
      data: { name: playlistName, userId: eid },
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
  if (err instanceof SpotifyError) {
    if (err.httpStatus === 404) {
      return Response.json(
        { error: "Spotify playlist not found or not public" },
        { status: 404 },
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
          retryAfterSeconds: err.retryAfterSeconds ?? null,
        }),
        { status: 503, headers },
      );
    }
    if (err.httpStatus === 0) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    return Response.json(
      { error: "Spotify upstream error", upstreamStatus: err.httpStatus },
      { status: 502 },
    );
  }
  throw err;
}
