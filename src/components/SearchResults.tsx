"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AddToPlaylistMenu } from "@/components/AddToPlaylistMenu";
import type { NormalizedTrack, SongResponse } from "@/types/api";

type PlaylistOption = { id: string; name: string };
type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  const [save, setSave] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function onSave() {
    setSave("saving");
    setSaveError(null);
    try {
      await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album ?? undefined,
          spotifyId: track.spotifyId,
        }),
      });
      setSave("saved");
    } catch (err) {
      setSave("error");
      setSaveError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
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
