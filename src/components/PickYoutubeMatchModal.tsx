"use client";

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useNowPlaying } from "@/components/PlayerProvider";
import { friendlyOverrideError } from "@/components/SongList";
import type {
  Song,
  SongResponse,
  YoutubeSearchResponse,
  YoutubeSearchResult,
} from "@/types/api";

const CANDIDATE_LIMIT = 5;

type Props = {
  song: Song;
  open: boolean;
  onClose: () => void;
  onSelected: () => void;
  cachedResults: YoutubeSearchResult[] | null;
  onResultsCached: (results: YoutubeSearchResult[]) => void;
};

export function PickYoutubeMatchModal({
  song,
  open,
  onClose,
  onSelected,
  cachedResults,
  onResultsCached,
}: Props) {
  const [results, setResults] = useState<YoutubeSearchResult[] | null>(
    cachedResults,
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  // Reset transient state when the modal closes/reopens for a different song.
  useEffect(() => {
    if (!open) {
      setSelectingId(null);
      setSelectError(null);
      return;
    }
    setResults(cachedResults);
    setErrorMsg(null);
  }, [open, cachedResults]);

  // Fetch candidates once per song-session (cache hit short-circuits).
  useEffect(() => {
    if (!open) return;
    if (results) return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    const q = encodeURIComponent(`${song.artist} ${song.title}`);
    apiFetch<YoutubeSearchResponse>(`/api/youtube/search?q=${q}`)
      .then((res) => {
        if (cancelled) return;
        const sliced = res.results.slice(0, CANDIDATE_LIMIT);
        setResults(sliced);
        onResultsCached(sliced);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "youtube_quota_safeguard") {
          setErrorMsg("YouTube search limit reached. Try again after reset.");
        } else if (err instanceof ApiError) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg("Search failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, results, song.artist, song.title, onResultsCached]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function onSelect(candidate: YoutubeSearchResult) {
    if (selectingId) return;
    setSelectError(null);
    if (candidate.youtubeId === song.youtubeId) {
      onClose();
      return;
    }
    setSelectingId(candidate.youtubeId);
    try {
      await apiFetch<SongResponse>("/api/youtube/override", {
        method: "POST",
        body: JSON.stringify({ songId: song.id, youtubeUrl: candidate.url }),
      });
      onSelected();
      onClose();
    } catch (err) {
      setSelectError(friendlyOverrideError(err));
      setSelectingId(null);
    }
  }

  return (
    // Backdrop spans the full viewport so clicks anywhere outside the dialog
    // dismiss it. Inner padding pushes the dialog away from the navbar (top)
    // and the music player (bottom) so vertical centering looks centered
    // within the actual content area, not under/over chrome.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 pb-32 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="my-auto max-h-[calc(100vh-15rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick YouTube match"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Pick YouTube match</h2>
            <p className="truncate text-sm text-muted">
              {song.title} — {song.artist}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-border px-3 py-1 text-sm hover:border-accent"
          >
            Close
          </button>
        </div>

        {loading && <p className="text-sm text-muted">Searching YouTube…</p>}
        {errorMsg && <p className="text-sm text-danger">{errorMsg}</p>}
        {selectError && <p className="mb-2 text-sm text-danger">{selectError}</p>}
        {results && results.length === 0 && (
          <p className="text-sm text-muted">
            No YouTube results for this song. Use &ldquo;Change YouTube link&rdquo; to
            paste a URL.
          </p>
        )}
        {results && results.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded border border-border">
            {results.map((r) => (
              <CandidateRow
                key={r.youtubeId}
                candidate={r}
                isCurrent={r.youtubeId === song.youtubeId}
                selecting={selectingId === r.youtubeId}
                disableSelect={selectingId !== null && selectingId !== r.youtubeId}
                onSelect={() => onSelect(r)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Lightweight client mirror of the metadata splitter in
// src/components/YouTubeSearchResults.tsx — kept duplicated rather than imported
// because the search-results component owns search-page-specific concerns we
// don't want to pull into this modal's bundle.
function parseMetadata(rawTitle: string, rawChannel: string) {
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

function CandidateRow({
  candidate,
  isCurrent,
  selecting,
  disableSelect,
  onSelect,
}: {
  candidate: YoutubeSearchResult;
  isCurrent: boolean;
  selecting: boolean;
  disableSelect: boolean;
  onSelect: () => void;
}) {
  const { playSong } = useNowPlaying();
  const display = parseMetadata(candidate.title, candidate.channel);

  function onPreview() {
    // Synthetic Song so the player can render queue UI without a DB row.
    // Audio resolution is videoId-keyed, so the synthetic id is harmless.
    const transient: Song = {
      id: `transient:${candidate.youtubeId}`,
      title: display.title,
      artist: display.artist,
      album: null,
      spotifyId: null,
      youtubeId: candidate.youtubeId,
      youtubeAltIds: [],
      youtubeMatchType: null,
      youtubeMatchReason: null,
      youtubeMatchTitle: null,
      youtubeMatchChannel: null,
      createdAt: new Date(),
    };
    playSong(transient);
  }

  return (
    <li
      className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${
        isCurrent ? "bg-accent/10" : ""
      }`}
    >
      {candidate.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={candidate.thumbnailUrl}
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
            {formatDuration(candidate.durationSec)}
          </span>
          {isCurrent && (
            <span className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1 text-[9px] uppercase tracking-wide text-accent">
              Current
            </span>
          )}
        </div>
        <div className="truncate text-sm text-muted">{display.artist}</div>
        <div className="truncate text-xs text-muted/80">
          <span className="text-muted/60">Posted by</span> {candidate.channel}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onPreview}
          className="appearance-none rounded bg-muted px-3 py-1 text-xs font-medium text-background hover:bg-foreground"
        >
          ▶ Play
        </button>
        <button
          type="button"
          onClick={onSelect}
          disabled={selecting || disableSelect}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          {selecting ? "Saving…" : "Select"}
        </button>
      </div>
    </li>
  );
}
