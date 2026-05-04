import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchSongById, YoutubeError } from "@/lib/youtube";

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
  const songId = (body as Record<string, unknown>).songId;
  if (typeof songId !== "string" || songId.length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }

  const exists = await prisma.song.findUnique({
    where: { id: songId },
    select: { id: true },
  });
  if (!exists) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  try {
    await matchSongById(songId, { force: true });
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
