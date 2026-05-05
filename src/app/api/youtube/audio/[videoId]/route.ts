import { getSession, unauthorized } from "@/lib/auth";
import { isValidYoutubeId } from "@/lib/youtube";
import { evictAudioCache, resolveAudio } from "@/lib/playback/resolver";
import {
  ResolveError,
  type PlaybackStream,
  type ResolveErrorCode,
} from "@/lib/playback/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ videoId: string }> };

const STATUS_FOR_CODE: Record<ResolveErrorCode, number> = {
  invalid_video_id: 400,
  yt_dlp_missing: 502,
  extract_failed: 502,
  stream_403: 502,
  upstream_failed: 502,
  all_providers_failed: 502,
};

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
] as const;

function errorResponse(code: ResolveErrorCode, detail: string, videoId: string) {
  return Response.json(
    { error: code, videoId, detail },
    { status: STATUS_FOR_CODE[code] },
  );
}

async function fetchUpstream(stream: PlaybackStream, range: string | null) {
  const headers = new Headers();
  if (range) headers.set("range", range);
  return fetch(stream.url, { headers });
}

export async function GET(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { videoId } = await ctx.params;
  if (!isValidYoutubeId(videoId)) {
    return errorResponse("invalid_video_id", "videoId failed regex", videoId);
  }

  let stream: PlaybackStream;
  try {
    stream = await resolveAudio(videoId);
  } catch (err) {
    if (err instanceof ResolveError) {
      return errorResponse(err.code, err.detail, videoId);
    }
    console.error("[playback] unexpected resolver error", { videoId, err });
    return errorResponse("extract_failed", "unexpected resolver error", videoId);
  }

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetchUpstream(stream, range);
  } catch (err) {
    console.error("[playback] upstream fetch failed", { videoId, err });
    return errorResponse(
      "upstream_failed",
      `upstream fetch threw: ${(err as Error).message}`,
      videoId,
    );
  }

  // 403 from the YouTube CDN: cached URL might be stale (rare under a 45m TTL
  // but possible). Evict, re-resolve, retry once. If still 403 → stream_403.
  if (upstream.status === 403) {
    evictAudioCache(videoId);
    let retryStream: PlaybackStream;
    try {
      retryStream = await resolveAudio(videoId);
    } catch (err) {
      if (err instanceof ResolveError) {
        return errorResponse(err.code, err.detail, videoId);
      }
      return errorResponse("stream_403", "retry resolve threw", videoId);
    }
    try {
      upstream = await fetchUpstream(retryStream, range);
    } catch (err) {
      console.error("[playback] retry upstream fetch failed", { videoId, err });
      return errorResponse(
        "upstream_failed",
        `retry upstream fetch threw: ${(err as Error).message}`,
        videoId,
      );
    }
    if (upstream.status === 403) {
      console.error("[playback] upstream 403 after retry", { videoId });
      return errorResponse(
        "stream_403",
        "upstream returned 403 even after re-resolve",
        videoId,
      );
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error("[playback] upstream non-OK", {
      videoId,
      status: upstream.status,
    });
    return errorResponse(
      "upstream_failed",
      `upstream returned ${upstream.status}`,
      videoId,
    );
  }

  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", stream.contentType);
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // Stream URLs are IP-bound; never let an intermediary cache across clients.
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
