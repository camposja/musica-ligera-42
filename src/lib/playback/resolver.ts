import * as cache from "./cache";
import { createPipedProvider } from "./providers/piped";
import { ytDlpProvider } from "./providers/yt-dlp";
import {
  ResolveError,
  type PlaybackProvider,
  type PlaybackStream,
} from "./types";

// Memoized list. The SOLE place that reads PIPED_API_BASE_URL — providers
// themselves never touch process.env. Changing the env after the process
// starts requires a restart (see README).
let providers: PlaybackProvider[] | null = null;

function getPlaybackProviders(): PlaybackProvider[] {
  if (providers) return providers;
  const list: PlaybackProvider[] = [ytDlpProvider];
  const pipedBase = process.env.PIPED_API_BASE_URL?.trim();
  if (pipedBase) list.push(createPipedProvider(pipedBase));
  providers = list;
  return providers;
}

// Test seam: clears the memoized list so a test can flip env vars and
// re-call getPlaybackProviders() cleanly. Production code does not call this.
export function resetPlaybackProvidersForTests(): void {
  providers = null;
}

export async function resolveAudio(videoId: string): Promise<PlaybackStream> {
  const cached = cache.get(videoId);
  if (cached) return cached;

  const list = getPlaybackProviders();
  const failures: string[] = [];

  for (const provider of list) {
    try {
      const stream = await provider.resolve(videoId);
      // Sanity: the provider's `name` and the stream's `provider` literal
      // must agree. If they ever diverge, surface it loudly in dev.
      if (stream.provider !== provider.name) {
        console.warn(
          `[playback] provider name/literal mismatch: provider.name=${provider.name} stream.provider=${stream.provider}`,
        );
      }
      cache.set(videoId, stream);
      console.log("[playback] resolved", { videoId, provider: stream.provider });
      return stream;
    } catch (err) {
      const summary =
        err instanceof ResolveError
          ? `${provider.name}: ${err.code}: ${err.detail}`
          : `${provider.name}: ${(err as Error).message ?? String(err)}`;
      failures.push(summary);
      // If only one provider is registered, surface its original error so
      // existing error-code consumers (UI, audio-status) keep working.
      if (list.length === 1) throw err;
    }
  }

  throw new ResolveError("all_providers_failed", failures.join("; "));
}

export function evictAudioCache(videoId: string): void {
  cache.evict(videoId);
}

export { _resetForTests as _resetCacheForTests } from "./cache";
