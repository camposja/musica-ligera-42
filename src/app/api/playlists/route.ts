import {
  effectiveUserId,
  forbidden,
  getSession,
  unauthorized,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const eid = effectiveUserId(session);
  if (!eid) return forbidden();

  const playlists = await prisma.playlist.findMany({
    where: { userId: eid },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { songs: true } } },
  });
  return Response.json({ playlists });
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
  const name = (body as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const playlist = await prisma.playlist.create({
    data: { name: name.trim(), userId: eid },
  });
  return Response.json({ playlist }, { status: 201 });
}
