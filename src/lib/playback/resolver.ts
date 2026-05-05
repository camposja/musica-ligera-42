import * as cache from "./cache";
import { ytDlpProvider } from "./providers/yt-dlp";
import type { PlaybackProvider, PlaybackStream } from "./types";

const provider: PlaybackProvider = ytDlpProvider;

export async function resolveAudio(videoId: string): Promise<PlaybackStream> {
  const cached = cache.get(videoId);
  if (cached) return cached;
  const stream = await provider.resolve(videoId);
  cache.set(videoId, stream);
  return stream;
}

export function evictAudioCache(videoId: string): void {
  cache.evict(videoId);
}

export { _resetForTests as _resetCacheForTests } from "./cache";
