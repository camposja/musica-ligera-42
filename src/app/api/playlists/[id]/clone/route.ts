import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/playlists/[id]/clone
//
// Two modes, dispatched on body shape + session role:
//
//   1. Same-user clone (default)
//      Body: {} or { confirm omitted }
//      Source must belong to the effective user (USER's own, or OWNER's
//      acting-as user). 404 otherwise — same as nonexistent, no leak.
//
//   2. Cross-profile clone (OWNER admin op)
//      Body: { targetUserId: string }
//      Source can be any playlist on the system. Target must be a USER
//      profile (not OWNER). Bypasses effectiveUserId entirely.
//
// USER + targetUserId in body → 400 "Invalid body". Deliberately generic
// so a normal USER cannot probe role boundaries.
export async function POST(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id: sourceId } = await ctx.params;

  let body: Record<string, unknown> = {};
  const raw = await request.text();
  if (raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return Response.json({ error: "Invalid body" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  const targetUserIdRaw = body.targetUserId;
  const hasTargetUserId =
    typeof targetUserIdRaw === "string" && targetUserIdRaw.length > 0;

  // USER cannot specify a target. Also reject any non-string targetUserId
  // shape to keep the contract clean.
  if (hasTargetUserId && session.role !== "OWNER") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (
    "targetUserId" in body &&
    typeof targetUserIdRaw !== "string"
  ) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // Resolve the target user.
  let targetUserId: string;
  if (hasTargetUserId) {
    // OWNER cross-profile mode.
    const target = await prisma.user.findUnique({
      where: { id: targetUserIdRaw as string },
      select: { id: true, role: true },
    });
    if (!target || target.role !== "USER") {
      return Response.json({ error: "Invalid target" }, { status: 400 });
    }
    targetUserId = target.id;
  } else {
    // Same-user mode. Requires an effective user.
    const eid = effectiveUserId(session);
    if (!eid) return forbidden();
    targetUserId = eid;
  }

  // Load source. In same-user mode, scope by ownership so non-owners
  // see 404 (not 403) and can't probe existence.
  const source = await prisma.playlist.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      name: true,
      userId: true,
      songs: {
        orderBy: { order: "asc" },
        select: { songId: true, order: true },
      },
    },
  });
  if (!source) {
    return Response.json({ error: "Playlist not found" }, { status: 404 });
  }
  if (!hasTargetUserId && source.userId !== targetUserId) {
    return Response.json({ error: "Playlist not found" }, { status: 404 });
  }

  const cloned = await prisma.$transaction(async (tx) => {
    const created = await tx.playlist.create({
      data: {
        name: `${source.name} (Copy)`,
        userId: targetUserId,
        source: "CLONE",
        locked: false,
        clonedFromId: source.id,
        sourceLabel: "Copy",
      },
    });
    if (source.songs.length > 0) {
      await tx.playlistSong.createMany({
        data: source.songs.map((s) => ({
          playlistId: created.id,
          songId: s.songId,
          order: s.order,
        })),
      });
    }
    return created;
  });

  return Response.json({ playlist: cloned }, { status: 201 });
}
