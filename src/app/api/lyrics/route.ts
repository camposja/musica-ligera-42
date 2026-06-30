import { getSession, unauthorized } from "@/lib/auth";
import { getLyrics } from "@/lib/lyrics/service";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/lyrics?songId=<id> — session-gated. Returns a compact LyricsResponse
// ({ state: "found" | "instrumental" | "not_found" | "error" }); the `found`
// case includes the lyrics text. Transport/parser details are never exposed.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const songId = new URL(request.url).searchParams.get("songId");
  if (!songId || songId.trim().length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { title: true, artist: true, album: true },
  });
  if (!song) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  try {
    return Response.json(await getLyrics(song));
  } catch (err) {
    console.error("[lyrics] route error", { songId, err });
    return Response.json({ state: "error", error: "Couldn't load lyrics." });
  }
}
