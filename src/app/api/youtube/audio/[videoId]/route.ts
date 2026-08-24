import { getSession, unauthorized } from "@/lib/auth";
import { isValidYoutubeId } from "@/lib/youtube";
import { createMoovPatchTransform, ensureMoovPatch } from "@/lib/playback/moov-probe";
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

// Deliberately excludes validators like `etag`/`content-md5`: we may patch
// bytes in flight (moov duration fix), so upstream byte-identity claims must
// never reach the client. `last-modified` is dropped too when a patch applies.
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

// Absolute file offset of the response's first byte: 0 for a full 200, the
// content-range start for a 206. null = can't tell → serve unpatched.
function servedStartOffset(upstream: Response): number | null {
  if (upstream.status === 200) return 0;
  if (upstream.status !== 206) return null;
  const m = /^bytes (\d+)-/.exec(upstream.headers.get("content-range") ?? "");
  return m ? Number(m[1]) : null;
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
    // The retry produced a fresh cache entry — moov offsets (if any) are
    // probed against the fresh URL below, never carried over from the stale one.
    stream = retryStream;
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
      // Record what we asked for and what came back. A `range=bytes=0-` paired
      // with no content-range means the CDN refused an unbounded read — the
      // signature of a stale yt-dlp handing out token-restricted URLs.
      const context = `range=${range ?? "none"} content-range=${
        upstream.headers.get("content-range") ?? "none"
      }`;
      console.error("[playback] upstream 403 after retry", { videoId, context });
      return errorResponse(
        "stream_403",
        `upstream returned 403 even after re-resolve (${context})`,
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

  // Fragmented-MP4 duration fix: zero the init-moov duration fields in flight
  // so fragment-aware demuxers (Safari) don't double-count the duration. The
  // probe decision is cached per stream; any failure serves bytes unpatched.
  let body = upstream.body;
  const patch = await ensureMoovPatch(videoId, stream);
  if (patch.state === "offsets" && body) {
    const servedStart = servedStartOffset(upstream);
    const patchEnd = Math.max(...patch.offsets) + 4;
    if (servedStart !== null && servedStart < patchEnd) {
      body = body.pipeThrough(createMoovPatchTransform(patch.offsets, servedStart));
      // The patched body is size-preserving but not byte-identical to
      // upstream: never forward validators that claim byte-identity.
      headers.delete("last-modified");
    }
  }

  return new Response(body, {
    status: upstream.status,
    headers,
  });
}
