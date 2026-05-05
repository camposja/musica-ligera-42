import { ResolveError, type PlaybackProvider, type PlaybackStream } from "../types";

const CACHE_TTL_MS = 45 * 60 * 1000;
const TIMEOUT_MS = 5_000;

// Public Piped instances vary in response shape; treat anything we don't
// recognize as `extract_failed` rather than letting a TypeError escape.
type RawAudioStream = {
  url?: unknown;
  mimeType?: unknown;
  format?: unknown;
  bitrate?: unknown;
  contentLength?: unknown;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function pickStream(streams: RawAudioStream[]): RawAudioStream | undefined {
  // Preference: audio/mp4, then audio/webm, then any stream with a url.
  const m4a = streams.find((s) => {
    const mt = asString(s.mimeType) ?? "";
    return mt.startsWith("audio/mp4") || mt.startsWith("audio/m4a");
  });
  if (m4a) return m4a;
  const webm = streams.find((s) => asString(s.mimeType)?.startsWith("audio/webm"));
  if (webm) return webm;
  return streams.find((s) => typeof s.url === "string" && s.url.length > 0);
}

function mimeOrDefault(mt: string | undefined): string {
  if (!mt) return "audio/mp4";
  if (mt.startsWith("audio/")) return mt;
  return "audio/mp4";
}

// Factory: the resolver injects baseUrl. This module never reads process.env.
export function createPipedProvider(baseUrl: string): PlaybackProvider {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return {
    name: "piped",
    async resolve(videoId: string): Promise<PlaybackStream> {
      let res: Response;
      try {
        res = await fetch(`${trimmed}/streams/${videoId}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { accept: "application/json" },
        });
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        throw new ResolveError(
          "extract_failed",
          `piped fetch failed: ${message}`,
          err,
        );
      }

      if (!res.ok) {
        throw new ResolveError(
          "extract_failed",
          `piped returned status ${res.status}`,
        );
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw new ResolveError(
          "extract_failed",
          "piped returned non-JSON body",
          err,
        );
      }

      const audioStreams =
        body && typeof body === "object" && "audioStreams" in body
          ? (body as { audioStreams: unknown }).audioStreams
          : undefined;

      if (!Array.isArray(audioStreams) || audioStreams.length === 0) {
        throw new ResolveError(
          "extract_failed",
          "piped returned no usable audio stream",
        );
      }

      const picked = pickStream(audioStreams as RawAudioStream[]);
      const url = picked ? asString(picked.url) : undefined;
      if (!picked || !url) {
        throw new ResolveError(
          "extract_failed",
          "piped returned no usable audio stream",
        );
      }

      return {
        url,
        contentType: mimeOrDefault(asString(picked.mimeType)),
        contentLength: asNumber(picked.contentLength),
        expiresAt: Date.now() + CACHE_TTL_MS,
        provider: "piped",
      };
    },
  };
}
