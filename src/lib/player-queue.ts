/**
 * Pure helpers for the playback queue. Kept separate from PlayerProvider so
 * the logic is unit-testable without React or jsdom.
 */

export type Identified = { id: string };

/** Clamp a startIndex into [0, length-1]. Returns null when length is 0. */
export function clampIndex(idx: number, length: number): number | null {
  if (length <= 0) return null;
  if (idx < 0) return 0;
  if (idx >= length) return length - 1;
  return idx;
}

/** Index of the next entry, or null when already at the end. */
export function nextIndex(queueLength: number, currentIndex: number): number | null {
  if (queueLength <= 0) return null;
  if (currentIndex < 0) return null;
  if (currentIndex >= queueLength - 1) return null;
  return currentIndex + 1;
}

/** Index of the previous entry, or null when already at the start. */
export function previousIndex(
  queueLength: number,
  currentIndex: number,
): number | null {
  if (queueLength <= 0) return null;
  if (currentIndex <= 0) return null;
  return currentIndex - 1;
}

/**
 * Fisher-Yates shuffle of the OTHER items in the queue. The currently-playing
 * item moves to index 0; everything else is randomized after it. Mental model:
 * "play the rest of the playlist randomly from here."
 */
export function shuffleKeepingCurrent<T extends Identified>(
  queue: T[],
  currentIndex: number,
): { queue: T[]; currentIndex: number } {
  if (queue.length <= 1) return { queue: queue.slice(), currentIndex: 0 };
  const current = queue[currentIndex];
  const others = queue.filter((_, i) => i !== currentIndex);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return { queue: [current, ...others], currentIndex: 0 };
}

/**
 * Restore the original (pre-shuffle) order. Re-locates the currently playing
 * song's index in the original queue. If for some reason the current song
 * isn't in the original (shouldn't happen — queue is a snapshot), fall back
 * to index 0.
 */
export function unshuffleKeepingCurrent<T extends Identified>(
  originalQueue: T[],
  currentSongId: string,
): { queue: T[]; currentIndex: number } {
  const idx = originalQueue.findIndex((s) => s.id === currentSongId);
  return {
    queue: originalQueue.slice(),
    currentIndex: idx === -1 ? 0 : idx,
  };
}

/**
 * Returns the YouTube id of the next song in the queue if it's playable, or
 * null when:
 *   - we're at the end of the queue
 *   - the next song has no `youtubeId`
 *   - the next song's `youtubeId` doesn't match the 11-char video id format
 *
 * Used by PlayerBar to decide whether to preload the next stream's metadata.
 * Generic on the queue item shape so this file stays free of API types.
 */
import { isValidYoutubeId } from "@/lib/youtube-id";

export function getNextPlayableYoutubeId(
  queue: Array<{ youtubeId?: string | null }>,
  currentIndex: number,
): string | null {
  const next = queue[currentIndex + 1];
  if (!next) return null;
  if (!isValidYoutubeId(next.youtubeId)) return null;
  return next.youtubeId;
}
