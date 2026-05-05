import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { lockedResponse } from "@/lib/playlist-rules";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  const { id: playlistId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const songId = (body as Record<string, unknown>).songId;
  if (typeof songId !== "string" || songId.length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    select: { userId: true, locked: true },
  });
  if (!playlist) {
    return Response.json({ error: "Playlist not found" }, { status: 404 });
  }
  if (playlist.userId !== eid) return forbidden();
  if (playlist.locked) return lockedResponse();

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { id: true },
  });
  if (!song) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  const last = await prisma.playlistSong.findFirst({
    where: { playlistId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = last ? last.order + 1 : 0;

  try {
    const ps = await prisma.playlistSong.create({
      data: { playlistId, songId, order: nextOrder },
    });
    return Response.json({ playlistSong: ps }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return Response.json(
        { error: "Song already in playlist" },
        { status: 409 },
      );
    }
    throw err;
  }
}
