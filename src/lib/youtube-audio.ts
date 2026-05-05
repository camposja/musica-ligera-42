import { Innertube } from "youtubei.js";

export type AudioStreamInfo = {
  url: string;
  contentType: string;
  contentLength?: number;
  expiresAt: number;
};

export class AudioExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AudioExtractionError";
  }
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, AudioStreamInfo>();

let clientPromise: Promise<Innertube> | null = null;

function getClient(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create();
  }
  return clientPromise;
}

export function _resetAudioCacheForTests(): void {
  cache.clear();
  clientPromise = null;
}

/**
 * Resolve a direct audio stream URL for a YouTube video using youtubei.js's
 * InnerTube reverse-engineered API. Prefers `audio/mp4` (Safari can play AAC;
 * it can't play YouTube's `audio/webm` opus streams), falling back to any
 * container when no mp4 audio-only format exists.
 *
 * Result URL is **bound to the requesting IP** (this server's IP), so the
 * route handler must proxy the bytes — a 302 redirect would 403 from the
 * browser's IP. URLs typically last ~6 hours upstream; we cache for 1 hour.
 */
export async function getAudioStreamInfo(videoId: string): Promise<AudioStreamInfo> {
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  let client: Innertube;
  try {
    client = await getClient();
  } catch (err) {
    // If client construction fails, drop the cached promise so the next call
    // can retry from scratch instead of returning the same broken client.
    clientPromise = null;
    console.error("[youtube-audio] Innertube.create failed", { err });
    throw new AudioExtractionError("Innertube.create failed", err);
  }

  let format: Awaited<ReturnType<Innertube["getStreamingData"]>>;
  try {
    format = await client.getStreamingData(videoId, {
      type: "audio",
      quality: "best",
      format: "mp4",
    });
  } catch {
    try {
      format = await client.getStreamingData(videoId, {
        type: "audio",
        quality: "best",
        format: "any",
      });
    } catch (err) {
      console.error("[youtube-audio] getStreamingData failed", { videoId, err });
      throw new AudioExtractionError(
        `getStreamingData failed for ${videoId}`,
        err,
      );
    }
  }

  if (!format.url) {
    throw new AudioExtractionError(`chosen format has no URL for ${videoId}`);
  }

  const result: AudioStreamInfo = {
    url: format.url,
    contentType: (format.mime_type ?? "audio/mp4").split(";")[0].trim(),
    contentLength: format.content_length,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache.set(videoId, result);
  return result;
}
