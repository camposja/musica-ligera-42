"use client";

import Link from "next/link";
import { useNowPlaying } from "@/components/PlayerProvider";
import { VIDEO_ID_RE } from "@/components/YouTubePlayer";
import type { LibraryPlaylistRef, LibrarySearchResult } from "@/types/api";

type Props = {
  songs: LibrarySearchResult[];
  playlists: LibraryPlaylistRef[];
};

// Results from the user's own saved library. Songs are real Song rows, so they
// play through the existing player and link back to a containing playlist;
// playlists link to their detail page. Intentionally NOT the Spotify-shaped
// SearchResults (which needs a spotifyId + save/match round-trip).
export function LibrarySearchResults({ songs, playlists }: Props) {
  const { playQueue } = useNowPlaying();

  const playable = songs.filter(
    (s) => s.youtubeId !== null && VIDEO_ID_RE.test(s.youtubeId),
  );

  function play(songId: string) {
    const idx = playable.findIndex((s) => s.id === songId);
    if (idx === -1) return;
    playQueue(playable, idx);
  }

  return (
    <div className="flex flex-col gap-4">
      {songs.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-muted">Songs</div>
          <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
            {songs.map((song) => {
              const canPlay =
                song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId);
              const home = song.playlists[0];
              return (
                <li
                  key={song.id}
                  className="flex items-center gap-3 px-3 py-3 sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{song.title}</div>
                    <div className="truncate text-sm text-muted">
                      {song.artist}
                      {song.album ? ` — ${song.album}` : ""}
                    </div>
                    {home && (
                      <div className="truncate text-xs text-muted/80">
                        <span className="text-muted/60">In</span>{" "}
                        <Link
                          href={`/playlist/${home.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {home.name}
                        </Link>
                        {song.playlists.length > 1
                          ? ` +${song.playlists.length - 1} more`
                          : ""}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => canPlay && play(song.id)}
                    disabled={!canPlay}
                    className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:cursor-not-allowed disabled:bg-border disabled:text-muted sm:text-sm"
                  >
                    {canPlay ? "▶ Play" : "No match"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {playlists.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-muted">
            Playlists
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
            {playlists.map((pl) => (
              <li key={pl.id}>
                <Link
                  href={`/playlist/${pl.id}`}
                  className="flex items-center justify-between px-3 py-3 hover:bg-background sm:px-4"
                >
                  <span className="truncate font-medium">{pl.name}</span>
                  <span className="shrink-0 text-xs text-muted">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
