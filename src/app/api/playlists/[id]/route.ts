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

const DELETE_CONFIRMATION = "confirm delete";

export async function DELETE(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  // Require typed confirmation in body. Case-insensitive trim match.
  // The UI uses the same string; the API gate is the load-bearing one.
  let confirm = "";
  const raw = await request.text();
  if (raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const v = (parsed as Record<string, unknown>).confirm;
        if (typeof v === "string") confirm = v;
      }
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  if (confirm.trim().toLowerCase() !== DELETE_CONFIRMATION) {
    return Response.json(
      { error: `Type "${DELETE_CONFIRMATION}" to confirm deletion` },
      { status: 400 },
    );
  }

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
