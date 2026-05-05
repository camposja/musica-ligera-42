import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidYoutubeId, matchSongById, YoutubeError } from "@/lib/youtube";

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
  const songId = (body as Record<string, unknown>).songId;
  if (typeof songId !== "string" || songId.length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }
  const force = (body as Record<string, unknown>).force === true;
  if (force && session.role !== "OWNER") return forbidden();

  const existing = await prisma.song.findUnique({
    where: { id: songId },
    select: { id: true, youtubeId: true },
  });
  if (!existing) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  // Short-circuit: a background match (or an earlier explicit one) may have
  // already filled youtubeId. Return without burning quota when the caller
  // didn't explicitly ask to redo the match.
  if (!force && existing.youtubeId && isValidYoutubeId(existing.youtubeId)) {
    const song = await prisma.song.findUnique({ where: { id: songId } });
    return Response.json({ song });
  }

  try {
    await matchSongById(songId, { force });
  } catch (err) {
    return youtubeErrorResponse(err);
  }

  const updated = await prisma.song.findUnique({ where: { id: songId } });
  return Response.json({ song: updated });
}

function youtubeErrorResponse(err: unknown): Response {
  if (err instanceof YoutubeError) {
    if (err.httpStatus === 404) {
      return Response.json(
        { error: "No YouTube match found" },
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
          error: "YouTube rate limit",
          retryAfterSeconds: err.retryAfterSeconds ?? null,
        }),
        { status: 503, headers },
      );
    }
    if (err.httpStatus === 0) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    return Response.json(
      { error: "YouTube upstream error", upstreamStatus: err.httpStatus },
      { status: 502 },
    );
  }
  throw err;
}
