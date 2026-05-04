import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  const { id } = await ctx.params;
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      songs: {
        orderBy: { order: "asc" },
        include: { song: true },
      },
    },
  });
  if (!playlist) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (playlist.userId !== eid) return forbidden();

  return Response.json({ playlist });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  const { id } = await ctx.params;
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!playlist) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (playlist.userId !== eid) return forbidden();

  await prisma.playlist.delete({ where: { id } });
  return Response.json({ ok: true });
}
