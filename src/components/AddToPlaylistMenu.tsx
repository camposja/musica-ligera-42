"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { NormalizedTrack, SongResponse } from "@/types/api";

type PlaylistOption = { id: string; name: string };
type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; playlistName: string }
  | { kind: "duplicate" }
  | { kind: "error"; message: string };

type Props = {
  track: NormalizedTrack;
  playlists: PlaylistOption[];
};

export function AddToPlaylistMenu({ track, playlists }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function add(playlistId: string, playlistName: string) {
    setStatus({ kind: "saving" });
    try {
      const songRes = await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album ?? undefined,
          spotifyId: track.spotifyId,
        }),
      });
      try {
        await apiFetch(`/api/playlists/${playlistId}/add-song`, {
          method: "POST",
          body: JSON.stringify({ songId: songRes.song.id }),
        });
        setStatus({ kind: "ok", playlistName });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setStatus({ kind: "duplicate" });
          return;
        }
        throw err;
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Add failed",
      });
    }
  }

  if (playlists.length === 0) {
    return (
      <span className="text-xs text-muted">No playlists — create one first.</span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        defaultValue=""
        onChange={(e) => {
          const p = playlists.find((x) => x.id === e.target.value);
          if (p) add(p.id, p.name);
          e.target.value = "";
        }}
        disabled={status.kind === "saving"}
        className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
      >
        <option value="" disabled>
          {status.kind === "saving" ? "Adding…" : "+ Add to playlist…"}
        </option>
        {playlists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {status.kind === "ok" && (
        <span className="text-xs text-accent">Added to {status.playlistName}</span>
      )}
      {status.kind === "duplicate" && (
        <span className="text-xs text-muted">Already in this playlist</span>
      )}
      {status.kind === "error" && (
        <span className="text-xs text-danger">{status.message}</span>
      )}
    </div>
  );
}
