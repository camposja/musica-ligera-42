"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useNowPlaying } from "@/components/PlayerProvider";
import { VIDEO_ID_RE } from "@/components/YouTubePlayer";
import { PickYoutubeMatchModal } from "@/components/PickYoutubeMatchModal";
import type { Song, YoutubeSearchResult } from "@/types/api";

type Role = "OWNER" | "USER";

type Props = {
  playlistId: string;
  songs: Array<{ order: number; song: Song }>;
  locked?: boolean;
  role?: Role;
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
  const isPicked = song.youtubeMatchReason === "manual";
  const reasonLabel = isPicked
    ? "Picked"
    : (song.youtubeMatchReason && REASON_LABELS[song.youtubeMatchReason]) ??
      "Loose match";
  const tooltip = song.youtubeMatchTitle && song.youtubeMatchChannel
    ? `Matched: "${song.youtubeMatchTitle}" by ${song.youtubeMatchChannel}`
    : isPicked
      ? "Owner-picked YouTube match"
      : "This is a loose match — close to the song but not the canonical version";
  // OWNER-picked rows wear a neutral grey pill so they're visually distinct
  // from auto-loose (green); auto-loose still uses the accent color.
  const className = isPicked
    ? "inline-flex shrink-0 items-center rounded border border-foreground/40 bg-foreground/5 px-1 py-[1px] text-[8px] uppercase tracking-wide text-foreground sm:px-1.5 sm:py-0.5 sm:text-[10px]"
    : "inline-flex shrink-0 items-center rounded border border-accent/40 bg-accent/10 px-1 py-[1px] text-[8px] uppercase tracking-wide text-accent sm:px-1.5 sm:py-0.5 sm:text-[10px]";
  return (
    <span title={tooltip} className={className}>
      {reasonLabel}
    </span>
  );
}

const OVERRIDE_BTN_CLASS =
  "shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-accent disabled:opacity-50";

// Maps the override route's `code` field to friendly UI copy. Unknown codes
// (or non-ApiError throws) fall back to the server's `error` message so the
// API stays the source of truth for anything we haven't categorized yet.
export function friendlyOverrideError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "parse_failed":
        return "That doesn't look like a YouTube link.";
      case "not_found":
        return "Couldn't find that video — it may have been removed.";
      case "private":
        return "That video is private and can't be played.";
      case "upstream_unreachable":
        return "Couldn't reach YouTube right now. Try again.";
    }
    return err.message;
  }
  return "Override failed";
}

function OverrideButtons({
  songId,
  isPlayable,
  onOpen,
  onPickMatch,
  onRefreshed,
}: {
  songId: string;
  isPlayable: boolean;
  onOpen: () => void;
  onPickMatch?: () => void;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rematch() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/youtube/match", {
        method: "POST",
        body: JSON.stringify({ songId, force: true }),
      });
      onRefreshed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rematch failed");
    } finally {
      setBusy(false);
    }
  }

  // Two button matrices, never both:
  //   - Repair-relevant rows (unmatched / loose / picked) get Pick YT match
  //     on top, then Change/Add link below. No Rerun — too many buttons, and
  //     a manual override is the right tool here.
  //   - Auto-exact rows get only Rerun auto-match. No paste-link affordance,
  //     no Pick — the row already has the right answer.
  if (onPickMatch) {
    return (
      <>
        <button type="button" onClick={onPickMatch} className={OVERRIDE_BTN_CLASS}>
          Pick YT match
        </button>
        <button type="button" onClick={onOpen} className={OVERRIDE_BTN_CLASS}>
          {isPlayable ? "Change YouTube link" : "Add YouTube link"}
        </button>
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={rematch}
        disabled={busy}
        className={OVERRIDE_BTN_CLASS}
      >
        {busy ? "Rematching…" : "Rerun auto-match"}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </>
  );
}

function OverrideEditor({
  songId,
  onSaved,
  onCancel,
}: {
  songId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/youtube/override", {
        method: "POST",
        body: JSON.stringify({ songId, youtubeUrl: value.trim() }),
      });
      onSaved();
    } catch (err) {
      setError(friendlyOverrideError(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 pb-3 pt-2 sm:px-4">
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste YouTube URL or video id…"
        className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs"
        autoFocus
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || value.trim().length === 0}
        className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded border border-border px-2 py-1 text-xs text-muted disabled:opacity-50"
      >
        Cancel
      </button>
      {error && <span className="basis-full text-xs text-danger">{error}</span>}
    </div>
  );
}

export function SongList({ playlistId, songs, locked = false, role }: Props) {
  const router = useRouter();
  const { playQueue, song: nowPlaying } = useNowPlaying();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openOverrideSongId, setOpenOverrideSongId] = useState<string | null>(
    null,
  );
  const [pickModalSongId, setPickModalSongId] = useState<string | null>(null);
  // Per-songId cache of YouTube candidates for the page session. Kept here so
  // closing + reopening the modal for the same song doesn't re-charge the
  // 103-unit search.
  const [pickResultsCache, setPickResultsCache] = useState<
    Map<string, YoutubeSearchResult[]>
  >(new Map());

  if (songs.length === 0) {
    return (
      <p className="rounded border border-border bg-surface p-6 text-sm text-muted">
        This playlist is empty. Use Search to add songs.
      </p>
    );
  }

  // Snapshot of all currently-playable songs in playlist order. Clicking Play
  // on any one of them starts queue playback from that position.
  const playableSongs = songs
    .map(({ song }) => song)
    .filter((song) => song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId));

  function startQueueFrom(songId: string) {
    const idx = playableSongs.findIndex((s) => s.id === songId);
    if (idx === -1) return;
    playQueue(playableSongs, idx);
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

  const isOwner = role === "OWNER";

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
        {songs.map(({ song, order }) => {
          const playable = song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId);
          const isPlaying = nowPlaying?.id === song.id;
          const editorOpen = openOverrideSongId === song.id;
          return (
            <li
              key={song.id}
              className={`flex flex-col ${isPlaying ? "bg-accent/10" : ""}`}
            >
              <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
                <span className="w-6 text-right text-xs text-muted">
                  {order + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{song.title}</div>
                  <div className="truncate text-sm text-muted">
                    {song.artist}
                    {song.album ? ` — ${song.album}` : ""}
                  </div>
                  {song.youtubeMatchType === "loose" && (
                    <div className="mt-1">
                      <MatchBadge song={song} />
                    </div>
                  )}
                  {!playable && (
                    <div className="mt-0.5 text-xs text-muted">
                      YouTube match still in progress — refresh to check.
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => playable && startQueueFrom(song.id)}
                      disabled={!playable}
                      className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:cursor-not-allowed disabled:bg-border disabled:text-muted sm:text-sm"
                    >
                      {playable ? "▶ Play" : "Matching…"}
                    </button>
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => remove(song.id)}
                        disabled={removingId === song.id}
                        className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-muted hover:text-danger disabled:opacity-50 sm:text-sm"
                      >
                        {removingId === song.id ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                  {isOwner && (
                    <OverrideButtons
                      songId={song.id}
                      isPlayable={playable}
                      onOpen={() => setOpenOverrideSongId(song.id)}
                      onPickMatch={
                        // Repair tool, not a search affordance: only show on
                        // unmatched / loose-matched rows where it actually helps.
                        !playable || song.youtubeMatchType === "loose"
                          ? () => setPickModalSongId(song.id)
                          : undefined
                      }
                      onRefreshed={() => router.refresh()}
                    />
                  )}
                </div>
              </div>
              {isOwner && editorOpen && (
                <OverrideEditor
                  songId={song.id}
                  onSaved={() => {
                    setOpenOverrideSongId(null);
                    router.refresh();
                  }}
                  onCancel={() => setOpenOverrideSongId(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {isOwner && pickModalSongId && (() => {
        const target = songs.find((s) => s.song.id === pickModalSongId);
        if (!target) return null;
        return (
          <PickYoutubeMatchModal
            song={target.song}
            open={true}
            onClose={() => setPickModalSongId(null)}
            onSelected={() => router.refresh()}
            cachedResults={pickResultsCache.get(pickModalSongId) ?? null}
            onResultsCached={(results) => {
              setPickResultsCache((prev) => {
                const next = new Map(prev);
                next.set(pickModalSongId, results);
                return next;
              });
            }}
          />
        );
      })()}
    </div>
  );
}
