"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useNowPlaying } from "@/components/PlayerProvider";
import type { Song, SongResponse, YoutubeSearchResult } from "@/types/api";

type PlaylistOption = { id: string; name: string };
type SaveStatus = "idle" | "saving" | "saved" | "error";
type CopyStatus = "idle" | "copied" | "error";

type Props = {
  results: YoutubeSearchResult[];
  playlists: PlaylistOption[];
};

// Mirror of `parseYoutubeMetadata` from src/lib/youtube-search.ts. Duplicated
// so the client doesn't need a server lib import; kept tiny and identical.
function parseYoutubeMetadata(rawTitle: string, rawChannel: string) {
  const channel = rawChannel
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/VEVO\s*$/i, "")
    .trim();
  const t = rawTitle.trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: t, artist: channel };
}

function formatDuration(sec: number): string {
  if (sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function songPayloadFromYoutube(r: YoutubeSearchResult) {
  const { title, artist } = parseYoutubeMetadata(r.title, r.channel);
  return {
    title,
    artist,
    youtubeId: r.youtubeId,
    youtubeMatchType: "loose",
    youtubeMatchReason: "manual",
    youtubeMatchTitle: r.title,
    youtubeMatchChannel: r.channel,
  };
}

export function YouTubeSearchResults({ results, playlists }: Props) {
  if (results.length === 0) return null;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
      {results.map((r) => (
        <ResultRow key={r.youtubeId} result={r} playlists={playlists} />
      ))}
    </ul>
  );
}

function ResultRow({
  result,
  playlists,
}: {
  result: YoutubeSearchResult;
  playlists: PlaylistOption[];
}) {
  const { playSong, song: nowPlaying } = useNowPlaying();
  const [save, setSave] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playState, setPlayState] = useState<"idle" | "starting">("idle");
  const [playError, setPlayError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyStatus>("idle");

  const isPlaying =
    nowPlaying?.youtubeId === result.youtubeId ||
    nowPlaying?.youtubeId === result.youtubeId;
  const display = parseYoutubeMetadata(result.title, result.channel);

  async function onSave() {
    setSave("saving");
    setSaveError(null);
    try {
      await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify(songPayloadFromYoutube(result)),
      });
      setSave("saved");
    } catch (err) {
      setSave("error");
      setSaveError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function onPlay() {
    setPlayState("starting");
    setPlayError(null);
    try {
      const songRes = await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify(songPayloadFromYoutube(result)),
      });
      const song: Song = songRes.song;
      if (!song.youtubeId) {
        throw new Error("No YouTube id on saved song");
      }
      playSong(song);
      setPlayState("idle");
    } catch (err) {
      setPlayState("idle");
      setPlayError(err instanceof ApiError ? err.message : "Play failed");
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(result.url);
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2000);
    } catch {
      setCopy("error");
      setTimeout(() => setCopy("idle"), 2000);
    }
  }

  return (
    <li
      className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${
        isPlaying ? "bg-[#ff0000]/10" : ""
      }`}
    >
      {result.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.thumbnailUrl}
          alt=""
          width={64}
          height={36}
          className="h-9 w-16 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-9 w-16 flex-shrink-0 rounded bg-border" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0">
          <span className="truncate font-medium">{display.title}</span>
          <span className="shrink-0 text-xs text-muted">
            {formatDuration(result.durationSec)}
          </span>
        </div>
        <div className="truncate text-sm text-muted">{display.artist}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPlay}
            disabled={playState === "starting"}
            className="appearance-none rounded bg-[#ff0000] px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {playState === "starting" ? "Saving…" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={save === "saving" || save === "saved"}
            className="rounded border border-border px-3 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
          >
            {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="rounded border border-border px-3 py-1 text-xs text-muted hover:text-foreground"
          >
            {copy === "copied"
              ? "Copied"
              : copy === "error"
                ? "Copy failed"
                : "Copy link"}
          </button>
        </div>
        <YouTubeAddToPlaylist result={result} playlists={playlists} />
        {playError && (
          <span className="max-w-[220px] break-words text-right text-xs text-danger">
            {playError}
          </span>
        )}
        {saveError && (
          <span className="max-w-[220px] break-words text-right text-xs text-danger">
            {saveError}
          </span>
        )}
      </div>
    </li>
  );
}

function YouTubeAddToPlaylist({
  result,
  playlists,
}: {
  result: YoutubeSearchResult;
  playlists: PlaylistOption[];
}) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; playlistName: string }
    | { kind: "duplicate" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function add(playlistId: string, playlistName: string) {
    setStatus({ kind: "saving" });
    try {
      const songRes = await apiFetch<SongResponse>("/api/songs", {
        method: "POST",
        body: JSON.stringify(songPayloadFromYoutube(result)),
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
        className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
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
