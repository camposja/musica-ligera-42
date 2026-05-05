"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useNowPlaying } from "@/components/PlayerProvider";
import { VIDEO_ID_RE } from "@/components/YouTubePlayer";
import type { Song } from "@/types/api";

type Props = {
  playlistId: string;
  songs: Array<{ order: number; song: Song }>;
};

const REASON_LABELS: Record<string, string> = {
  live: "Live version",
  lyric_video: "Lyric video",
  official_audio: "Official audio",
  acoustic: "Acoustic",
  remaster: "Remaster",
  remix: "Remix",
  close: "Close match",
};

function MatchBadge({ song }: { song: Song }) {
  // Only loose matches get a badge — exact matches and legacy/unmatched
  // (matchType === null) stay clean. The badge tells the user this isn't
  // the canonical version of the song.
  if (song.youtubeMatchType !== "loose") return null;
  const reasonLabel =
    (song.youtubeMatchReason && REASON_LABELS[song.youtubeMatchReason]) ??
    "Loose match";
  return (
    <span
      title={
        song.youtubeMatchTitle && song.youtubeMatchChannel
          ? `Matched: "${song.youtubeMatchTitle}" by ${song.youtubeMatchChannel}`
          : "This is a loose match — close to the song but not the canonical version"
      }
      className="inline-flex shrink-0 items-center rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent"
    >
      {reasonLabel}
    </span>
  );
}

export function SongList({ playlistId, songs }: Props) {
  const router = useRouter();
  const { playSong, song: nowPlaying } = useNowPlaying();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (songs.length === 0) {
    return (
      <p className="rounded border border-border bg-surface p-6 text-sm text-muted">
        This playlist is empty. Use Search to add songs.
      </p>
    );
  }

  async function remove(songId: string) {
    setRemovingId(songId);
    setError(null);
    try {
      await apiFetch(`/api/playlists/${playlistId}/remove-song`, {
        method: "POST",
        body: JSON.stringify({ songId }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
        {songs.map(({ song, order }) => {
          const playable = song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId);
          const isPlaying = nowPlaying?.id === song.id;
          return (
            <li
              key={song.id}
              className={`flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4 ${
                isPlaying ? "bg-accent/10" : ""
              }`}
            >
              <span className="w-6 text-right text-xs text-muted">{order + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">{song.title}</span>
                  <MatchBadge song={song} />
                </div>
                <div className="truncate text-sm text-muted">
                  {song.artist}
                  {song.album ? ` — ${song.album}` : ""}
                </div>
                {!playable && (
                  <div className="mt-0.5 text-xs text-muted">
                    YouTube match still in progress — refresh to check.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => playable && playSong(song)}
                disabled={!playable}
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:cursor-not-allowed disabled:bg-border disabled:text-muted sm:text-sm"
              >
                {playable ? "▶ Play" : "Matching…"}
              </button>
              <button
                type="button"
                onClick={() => remove(song.id)}
                disabled={removingId === song.id}
                className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-muted hover:text-danger disabled:opacity-50 sm:text-sm"
              >
                {removingId === song.id ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
