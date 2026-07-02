import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidYoutubeId } from "@/lib/youtube";
import { resolveAudio } from "@/lib/playback/resolver";
import { ResolveError, type ResolveErrorCode } from "@/lib/playback/types";

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

export async function GET(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { videoId } = await ctx.params;
  if (!isValidYoutubeId(videoId)) {
    return Response.json(
      { ok: false, code: "invalid_video_id", detail: "videoId failed regex" },
      { status: 400 },
    );
  }

  try {
    const stream = await resolveAudio(videoId);
    // Self-heal Song.youtubeDurationSeconds from the resolver's authoritative
    // duration (yt-dlp reports it; Piped doesn't). Intentional GET side
    // effect: this probe already runs before every playback, the write is an
    // idempotent single-column update scoped to this youtubeId, and it must
    // never fail the status response.
    if (stream.durationSeconds) {
      try {
        await prisma.song.updateMany({
          where: { youtubeId: videoId },
          data: { youtubeDurationSeconds: stream.durationSeconds },
        });
      } catch (err) {
        console.warn("[audio-status] duration self-heal write failed", {
          videoId,
          err,
        });
      }
    }
    return Response.json({
      ok: true,
      contentType: stream.contentType,
      contentLength: stream.contentLength ?? null,
      durationSeconds: stream.durationSeconds ?? null,
      provider: stream.provider,
    });
  } catch (err) {
    if (err instanceof ResolveError) {
      return Response.json(
        { ok: false, code: err.code, detail: err.detail },
        { status: STATUS_FOR_CODE[err.code] },
      );
    }
    console.error("[audio-status] unexpected error", { videoId, err });
    return Response.json(
      { ok: false, code: "extract_failed", detail: "unexpected resolver error" },
      { status: 502 },
    );
  }
}
