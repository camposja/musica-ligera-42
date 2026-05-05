"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Song } from "@/types/api";
import {
  clampIndex,
  nextIndex,
  previousIndex,
  shuffleKeepingCurrent,
  unshuffleKeepingCurrent,
} from "@/lib/player-queue";

const MAX_CONSECUTIVE_ERRORS = 3;

type PlayerCtx = {
  song: Song | null;
  queue: Song[];
  currentIndex: number;
  shuffle: boolean;
  queueError: string | null;
  canPrev: boolean;
  canNext: boolean;
  playSong: (song: Song) => void;
  playQueue: (songs: Song[], startIndex: number) => void;
  playNext: () => void;
  playPrevious: () => void;
  toggleShuffle: () => void;
  reportPlaybackEnded: () => void;
  reportPlaybackError: () => void;
  stop: () => void;
};

const Ctx = createContext<PlayerCtx | null>(null);

type State = {
  originalQueue: Song[];
  queue: Song[];
  currentIndex: number;
  shuffle: boolean;
  consecutiveErrors: number;
  queueError: string | null;
};

const EMPTY: State = {
  originalQueue: [],
  queue: [],
  currentIndex: -1,
  shuffle: false,
  consecutiveErrors: 0,
  queueError: null,
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>(EMPTY);

  const playQueue = useCallback((songs: Song[], startIndex: number) => {
    const idx = clampIndex(startIndex, songs.length);
    if (idx === null) {
      setS(EMPTY);
      return;
    }
    setS({
      originalQueue: songs.slice(),
      queue: songs.slice(),
      currentIndex: idx,
      shuffle: false,
      consecutiveErrors: 0,
      queueError: null,
    });
  }, []);

  const playSong = useCallback(
    (song: Song) => {
      playQueue([song], 0);
    },
    [playQueue],
  );

  const stop = useCallback(() => {
    setS(EMPTY);
  }, []);

  const playNext = useCallback(() => {
    setS((cur) => {
      const nxt = nextIndex(cur.queue.length, cur.currentIndex);
      if (nxt === null) return EMPTY;
      return {
        ...cur,
        currentIndex: nxt,
        consecutiveErrors: 0,
        queueError: null,
      };
    });
  }, []);

  const playPrevious = useCallback(() => {
    setS((cur) => {
      const prv = previousIndex(cur.queue.length, cur.currentIndex);
      if (prv === null) return cur;
      return {
        ...cur,
        currentIndex: prv,
        consecutiveErrors: 0,
        queueError: null,
      };
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setS((cur) => {
      if (cur.queue.length === 0 || cur.currentIndex < 0) {
        return { ...cur, shuffle: !cur.shuffle };
      }
      if (!cur.shuffle) {
        const r = shuffleKeepingCurrent(cur.queue, cur.currentIndex);
        return {
          ...cur,
          shuffle: true,
          queue: r.queue,
          currentIndex: r.currentIndex,
        };
      }
      const currentSong = cur.queue[cur.currentIndex];
      const r = unshuffleKeepingCurrent(cur.originalQueue, currentSong.id);
      return {
        ...cur,
        shuffle: false,
        queue: r.queue,
        currentIndex: r.currentIndex,
      };
    });
  }, []);

  const reportPlaybackEnded = useCallback(() => {
    // Successful end-of-track: clear the error counter and advance.
    setS((cur) => ({ ...cur, consecutiveErrors: 0 }));
    playNext();
  }, [playNext]);

  const reportPlaybackError = useCallback(() => {
    setS((cur) => {
      const errs = cur.consecutiveErrors + 1;
      const nxt = nextIndex(cur.queue.length, cur.currentIndex);
      if (nxt === null || errs >= MAX_CONSECUTIVE_ERRORS) {
        return {
          ...EMPTY,
          queueError:
            errs >= MAX_CONSECUTIVE_ERRORS
              ? `Couldn't play any of the next ${MAX_CONSECUTIVE_ERRORS} songs — check yt-dlp`
              : "Playback failed and no next song to try",
        };
      }
      return {
        ...cur,
        currentIndex: nxt,
        consecutiveErrors: errs,
      };
    });
  }, []);

  const song = s.currentIndex >= 0 ? s.queue[s.currentIndex] ?? null : null;
  const canPrev = previousIndex(s.queue.length, s.currentIndex) !== null;
  const canNext = nextIndex(s.queue.length, s.currentIndex) !== null;

  return (
    <Ctx.Provider
      value={{
        song,
        queue: s.queue,
        currentIndex: s.currentIndex,
        shuffle: s.shuffle,
        queueError: s.queueError,
        canPrev,
        canNext,
        playSong,
        playQueue,
        playNext,
        playPrevious,
        toggleShuffle,
        reportPlaybackEnded,
        reportPlaybackError,
        stop,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useNowPlaying(): PlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNowPlaying must be used inside <PlayerProvider>");
  return ctx;
}
