import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  const songs = await prisma.song.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ songs });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

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

  if (typeof b.title !== "string" || b.title.trim().length === 0) {
    return Response.json({ error: "title required" }, { status: 400 });
  }
  if (typeof b.artist !== "string" || b.artist.trim().length === 0) {
    return Response.json({ error: "artist required" }, { status: 400 });
  }

  const album =
    typeof b.album === "string" && b.album.trim().length > 0
      ? b.album.trim()
      : null;
  const spotifyId =
    typeof b.spotifyId === "string" && b.spotifyId.length > 0
      ? b.spotifyId
      : null;
  const youtubeId =
    typeof b.youtubeId === "string" && b.youtubeId.length > 0
      ? b.youtubeId
      : null;

  let youtubeAltIds: string[] = [];
  if (Array.isArray(b.youtubeAltIds)) {
    if (!b.youtubeAltIds.every((x) => typeof x === "string")) {
      return Response.json(
        { error: "youtubeAltIds must be string[]" },
        { status: 400 },
      );
    }
    youtubeAltIds = b.youtubeAltIds as string[];
  }

  // Dedupe by spotifyId when provided: if a Song with that spotifyId already
  // exists, return it (200) instead of creating a duplicate. find-then-create
  // is intentional — no prisma.upsert, no createdAt heuristic.
  if (spotifyId) {
    const existing = await prisma.song.findUnique({ where: { spotifyId } });
    if (existing) {
      return Response.json({ song: existing }, { status: 200 });
    }
  }

  try {
    const song = await prisma.song.create({
      data: {
        title: b.title.trim(),
        artist: b.artist.trim(),
        album,
        spotifyId,
        youtubeId,
        youtubeAltIds,
      },
    });
    return Response.json({ song }, { status: 201 });
  } catch (err) {
    // Race-condition fallback: two concurrent POSTs with the same spotifyId
    // can both miss the findUnique above; the loser gets P2002 here.
    if (
      spotifyId &&
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.song.findUnique({ where: { spotifyId } });
      if (existing) {
        return Response.json({ song: existing }, { status: 200 });
      }
    }
    throw err;
  }
}
