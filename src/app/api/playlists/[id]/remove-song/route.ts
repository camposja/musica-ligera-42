import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
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
    select: { userId: true },
  });
  if (!playlist) {
    return Response.json({ error: "Playlist not found" }, { status: 404 });
  }
  if (playlist.userId !== eid) return forbidden();

  const ps = await prisma.playlistSong.findUnique({
    where: { playlistId_songId: { playlistId, songId } },
    select: { id: true },
  });
  if (!ps) {
    return Response.json({ error: "Song not in playlist" }, { status: 404 });
  }

  await prisma.playlistSong.delete({ where: { id: ps.id } });
  return Response.json({ ok: true });
}
