import type { PlaybackStream } from "./types";

const cache = new Map<string, PlaybackStream>();

export function get(videoId: string): PlaybackStream | null {
  const hit = cache.get(videoId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(videoId);
    return null;
  }
  return hit;
}

export function set(videoId: string, stream: PlaybackStream): void {
  cache.set(videoId, stream);
}

export function evict(videoId: string): void {
  cache.delete(videoId);
}

export function _resetForTests(): void {
  cache.clear();
}
