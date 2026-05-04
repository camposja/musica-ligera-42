import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidYoutubeId } from "@/lib/youtube";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.songId !== "string" || b.songId.length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }
  if (typeof b.newYoutubeId !== "string" || !isValidYoutubeId(b.newYoutubeId)) {
    return Response.json(
      { error: "newYoutubeId must be an 11-character YouTube id" },
      { status: 400 },
    );
  }

  const exists = await prisma.song.findUnique({
    where: { id: b.songId },
    select: { id: true },
  });
  if (!exists) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  const updated = await prisma.song.update({
    where: { id: b.songId },
    data: { youtubeId: b.newYoutubeId },
  });
  return Response.json({ song: updated });
}
