import { getSession, unauthorized } from "@/lib/auth";
import { isValidYoutubeId } from "@/lib/youtube";
import {
  AudioExtractionError,
  getAudioStreamInfo,
} from "@/lib/youtube-audio";

type Ctx = { params: Promise<{ videoId: string }> };

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
] as const;

export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { videoId } = await ctx.params;
  if (!isValidYoutubeId(videoId)) {
    return Response.json({ error: "Invalid videoId" }, { status: 400 });
  }

  let info;
  try {
    info = await getAudioStreamInfo(videoId);
  } catch (err) {
    if (err instanceof AudioExtractionError) {
      return Response.json(
        { error: "extraction_failed", videoId },
        { status: 502 },
      );
    }
    throw err;
  }

  // Forward the browser's Range header to YouTube's CDN so seeking in the
  // <audio> element works (browser sends `Range: bytes=N-`, CDN replies 206).
  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) upstreamHeaders.set("range", range);

  let upstream: Response;
  try {
    upstream = await fetch(info.url, { headers: upstreamHeaders });
  } catch (err) {
    console.error("[youtube-audio] upstream fetch failed", { videoId, err });
    return Response.json({ error: "upstream_fetch_failed" }, { status: 502 });
  }

  // 206 (Partial Content) is the expected success for a Range request.
  if (!upstream.ok && upstream.status !== 206) {
    console.error("[youtube-audio] upstream non-OK", {
      videoId,
      status: upstream.status,
    });
    return Response.json(
      { error: "upstream_error", upstreamStatus: upstream.status },
      { status: 502 },
    );
  }

  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", info.contentType);
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // Stream URLs are IP-bound; never let an intermediary cache them across clients.
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
