"use client";

import { useEffect, useRef, useState } from "react";
import { useNowPlaying } from "@/components/PlayerProvider";
import YouTubePlayer, { VIDEO_ID_RE } from "@/components/YouTubePlayer";
import { YouTubeAudioPlayer } from "@/components/YouTubeAudioPlayer";
import { getNextPlayableYoutubeId } from "@/lib/player-queue";

type AudioStatus = "probing" | "ready" | "error";
type AudioError = { code: string; detail: string };

const PRELOAD_AT_REMAINING_SEC = 25;

// Fire a preload of the next stream's metadata. Idempotent: shared dedupe ref
// prevents duplicate fetches for the same (current, next) pair.
function preloadNext(
  pairKey: string,
  nextId: string,
  ref: React.MutableRefObject<string | null>,
): void {
  if (ref.current === pairKey) return;
  ref.current = pairKey;
  fetch(`/api/youtube/audio-status/${nextId}`).catch((err) => {
    console.warn("[player] preload failed", { nextId, err });
  });
}

export function PlayerBar() {
  const {
    song,
    queue,
    currentIndex,
    shuffle,
    queueError,
    canPrev,
    canNext,
    playNext,
    playPrevious,
    toggleShuffle,
    reportPlaybackEnded,
    reportPlaybackError,
    stop,
  } = useNowPlaying();
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("probing");
  const [audioError, setAudioError] = useState<AudioError | null>(null);
  const [manualFallback, setManualFallback] = useState(false);
  // Pair-key dedupe ("currentSongId:nextYoutubeId") shared by both preload
  // triggers (immediate-on-song-start and 25s-remaining). Pair key is more
  // robust than just nextId across Prev/Next bouncing.
  const preloadedPairRef = useRef<string | null>(null);

  const videoId =
    song?.youtubeId && VIDEO_ID_RE.test(song.youtubeId) ? song.youtubeId : null;

  // Surface the next song's youtubeId as a derived value so the preload
  // effect's dep array can be precise (no false fires on unrelated state).
  const nextYoutubeId = getNextPlayableYoutubeId(queue, currentIndex);

  // Probe the audio-status endpoint whenever the song changes. The probe can
  // surface structured error codes (yt_dlp_missing, extract_failed, etc.); the
  // browser <audio onError> can't read response bodies so without the probe
  // the user would only see a generic media error.
  useEffect(() => {
    setAudioError(null);
    setManualFallback(false);
    preloadedPairRef.current = null;

    if (!videoId) {
      setAudioStatus("error");
      return;
    }

    setAudioStatus("probing");
    const ac = new AbortController();
    fetch(`/api/youtube/audio-status/${videoId}`, { signal: ac.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { ok: true }
          | { ok: false; code: string; detail: string }
          | null;
        if (res.ok && body && body.ok) {
          setAudioStatus("ready");
        } else {
          setAudioError(
            body && !body.ok
              ? { code: body.code, detail: body.detail }
              : { code: "extract_failed", detail: `status ${res.status}` },
          );
          setAudioStatus("error");
        }
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setAudioError({
          code: "extract_failed",
          detail: `probe network error: ${(err as Error).message}`,
        });
        setAudioStatus("error");
      });
    return () => ac.abort();
  }, [videoId]);

  // Immediate preload: as soon as we know the current song and the next
  // playable song, warm the resolver cache for the next so a Next click is
  // fast. Re-fires when the (current, next) pair shifts — which covers Next
  // clicks, auto-advance, and shuffle toggle (shuffle rewrites queue order).
  useEffect(() => {
    if (!song || !nextYoutubeId) return;
    const pairKey = `${song.id}:${nextYoutubeId}`;
    preloadNext(pairKey, nextYoutubeId, preloadedPairRef);
  }, [song?.id, nextYoutubeId]);

  // Show queue-error overlay if the queue gave up after consecutive failures.
  // It lives in the same UI slot as the per-song audioError display.
  if (!song && queueError) {
    return (
      <div className="border-b border-border bg-surface px-3 py-2 sm:px-4 sm:py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="text-sm text-danger">{queueError}</div>
          <button
            type="button"
            onClick={stop}
            aria-label="Dismiss queue error"
            className="shrink-0 rounded border border-border px-2 py-1 text-sm leading-none text-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  if (!song) return null;

  const queueLabel = queue.length > 1 ? `${currentIndex + 1} / ${queue.length}` : "";

  return (
    <div className="border-b border-border bg-surface px-3 py-2 sm:px-4 sm:py-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium sm:text-base">
                {song.title}
              </span>
              {queueLabel && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
                  {queueLabel}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted sm:text-sm">
              {song.artist}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={playPrevious}
              disabled={!canPrev}
              aria-label="Previous song"
              className="rounded border border-border px-2 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40 sm:text-sm"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={playNext}
              disabled={!canNext}
              aria-label="Next song"
              className="rounded border border-border px-2 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40 sm:text-sm"
            >
              Next
            </button>
            <button
              type="button"
              onClick={toggleShuffle}
              aria-pressed={shuffle}
              aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
              className={`rounded border px-2 py-1.5 text-xs sm:text-sm ${
                shuffle
                  ? "border-accent text-accent"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              Shuffle
            </button>
            <button
              type="button"
              onClick={stop}
              aria-label="Close player"
              className="rounded border border-border px-2 py-1 text-sm leading-none text-muted hover:text-foreground"
            >
              ×
            </button>
          </div>
        </div>
        {!videoId ? (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted">
            Auto-matching YouTube video for &ldquo;{song.title}&rdquo;…
          </div>
        ) : manualFallback ? (
          <div className="flex justify-center">
            <YouTubePlayer videoId={videoId} width={320} height={180} />
          </div>
        ) : audioStatus === "probing" ? (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted">
            Loading audio…
          </div>
        ) : audioStatus === "ready" ? (
          <YouTubeAudioPlayer
            videoId={videoId}
            onError={() => {
              setAudioError({
                code: "media_error",
                detail: "<audio> element fired onError after src load",
              });
              setAudioStatus("error");
              reportPlaybackError();
            }}
            onEnded={() => reportPlaybackEnded()}
            onTimeUpdate={(currentTime, duration) => {
              const remaining = duration - currentTime;
              if (remaining > PRELOAD_AT_REMAINING_SEC) return;
              if (!song || !nextYoutubeId) return;
              const pairKey = `${song.id}:${nextYoutubeId}`;
              preloadNext(pairKey, nextYoutubeId, preloadedPairRef);
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded border border-danger/40 bg-background px-3 py-2 text-sm">
            <div className="text-danger">
              Audio playback failed:{" "}
              <span className="font-mono">{audioError?.code ?? "unknown"}</span>
            </div>
            {audioError?.detail && (
              <div className="break-words text-xs text-muted">{audioError.detail}</div>
            )}
            <button
              type="button"
              onClick={() => setManualFallback(true)}
              className="self-start rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Try YouTube embed
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
