import { getSession, unauthorized } from "@/lib/auth";
import { searchTracks, SpotifyError } from "@/lib/spotify";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json({ error: "q required" }, { status: 400 });
  }

  try {
    const tracks = await searchTracks(q.trim());
    return Response.json({ tracks });
  } catch (err) {
    return spotifyErrorResponse(err);
  }
}

function spotifyErrorResponse(err: unknown): Response {
  if (err instanceof SpotifyError) {
    if (err.httpStatus === 429) {
      const headers = new Headers({ "content-type": "application/json" });
      if (err.retryAfterSeconds !== undefined) {
        headers.set("retry-after", String(err.retryAfterSeconds));
      }
      return new Response(
        JSON.stringify({ error: "Spotify rate limit", retryAfterSeconds: err.retryAfterSeconds ?? null }),
        { status: 503, headers },
      );
    }
    if (err.httpStatus === 0) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    return Response.json(
      { error: "Spotify upstream error", upstreamStatus: err.httpStatus },
      { status: 502 },
    );
  }
  throw err;
}
