"use client";

import { createContext, useContext, useState } from "react";
import type { Song } from "@/types/api";

type PlayerCtx = {
  song: Song | null;
  playSong: (song: Song) => void;
  stop: () => void;
};

const Ctx = createContext<PlayerCtx | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [song, setSong] = useState<Song | null>(null);
  return (
    <Ctx.Provider
      value={{
        song,
        playSong: setSong,
        stop: () => setSong(null),
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
