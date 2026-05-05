"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AddToPlaylistMenu } from "@/components/AddToPlaylistMenu";
import { useNowPlaying } from "@/components/PlayerProvider";
import { songPayloadFromTrack } from "@/lib/song-payload";
import { VIDEO_ID_RE } from "@/components/YouTubePlayer";
import type { NormalizedTrack, Song, SongResponse } from "@/types/api";

type PlaylistOption = { id: string; name: string };
type SaveStatus = "idle" | "saving" | "saved" | "error";
type PlayStatus = "idle" | "saving" | "matching" | "error";

type Props = {
  tracks: NormalizedTrack[];
  playlists: PlaylistOption[];
};

export function SearchResults({ tracks, playlists }: Props) {
  if (tracks.length === 0) return null;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
      {tracks.map((t) => (
        <ResultRow key={t.spotifyId} track={t} playlists={playlists} />
      ))}
    </ul>
  );
}

function ResultRow({
  track,
  playlists,
}: {
  track: NormalizedTrack;
  playlists: PlaylistOption[];
}) {
  const { playSong, song: nowPlaying } = useNowPlaying();
  const [save, setSave] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [play, setPlay] = useState<PlayStatus>("idle");
  const [playError, setPlayError] = useState<string | null>(null);

  const isPlaying = nowPlaying?.spotifyId === track.spotifyId;

  async function onSave() {
    setSave("saving");
    setSaveError(null);
    try {
      await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify(songPayloadFromTrack(track)),
      });
      setSave("saved");
    } catch (err) {
      setSave("error");
      setSaveError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function onPlay() {
    setPlay("saving");
    setPlayError(null);
    try {
      const songRes = await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify(songPayloadFromTrack(track)),
      });
      let song: Song = songRes.song;
      if (!song.youtubeId || !VIDEO_ID_RE.test(song.youtubeId)) {
        setPlay("matching");
        const matchRes = await apiFetch<SongResponse>("/api/youtube/match", {
          method: "POST",
          body: JSON.stringify({ songId: song.id }),
        });
        song = matchRes.song;
      }
      if (!song.youtubeId || !VIDEO_ID_RE.test(song.youtubeId)) {
        throw new Error("No YouTube match found");
      }
      playSong(song);
      setPlay("idle");
    } catch (err) {
      setPlay("error");
      const msg =
        err instanceof ApiError
          ? err.status === 404
            ? "No YouTube match found"
            : err.message
          : err instanceof Error
            ? err.message
            : "Play failed";
      setPlayError(msg);
    }
  }

  const playLabel =
    play === "saving"
      ? "Saving…"
      : play === "matching"
        ? "Finding match…"
        : "▶ Play";

  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 ${
        isPlaying ? "bg-accent/10" : ""
      }`}
    >
      {track.albumImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.albumImageUrl}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-12 w-12 flex-shrink-0 rounded bg-border" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{track.title}</div>
        <div className="truncate text-sm text-muted">
          {track.artist}
          {track.album ? ` — ${track.album}` : ""}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onPlay}
          disabled={play === "saving" || play === "matching"}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-foreground disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
        >
          {playLabel}
        </button>
        {play === "error" && playError && (
          <span className="max-w-[180px] break-words text-right text-xs text-danger">
            {playError}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onSave}
          disabled={save === "saving" || save === "saved"}
          className="rounded border border-border px-3 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : "Save"}
        </button>
        {save === "error" && saveError && (
          <span className="text-xs text-danger">{saveError}</span>
        )}
      </div>
      <AddToPlaylistMenu track={track} playlists={playlists} />
    </li>
  );
}
