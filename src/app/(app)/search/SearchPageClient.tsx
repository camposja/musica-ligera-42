"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { YouTubeSearchResults } from "@/components/YouTubeSearchResults";
import type {
  NormalizedTrack,
  QuotaStatus,
  SearchResponse,
  YoutubeSearchResponse,
  YoutubeSearchResult,
} from "@/types/api";

type PlaylistOption = { id: string; name: string };
type LoadState = "idle" | "loading" | "ready" | "error";

type Props = { playlists: PlaylistOption[] };

const SPOTIFY_BUTTON =
  "rounded bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50";
// Use the named `bg-yt-red` / `focus:border-yt-red` utilities (defined via
// the --yt-red CSS variable in globals.css). Named utilities are stable
// across Tailwind v4's production build and survive iOS Safari's CSS-cache
// quirks better than arbitrary `bg-[#ff0000]`. appearance-none and the
// search-cancel-button override neutralize Safari's native form styling.
const YOUTUBE_BUTTON =
  "appearance-none rounded bg-yt-red px-4 py-2 font-medium text-white disabled:opacity-60";
const YOUTUBE_INPUT =
  "flex-1 appearance-none rounded border border-border bg-background px-3 py-2 outline-none focus:border-yt-red [&::-webkit-search-cancel-button]:appearance-none";

export function SearchPageClient({ playlists }: Props) {
  // Spotify
  const [spotifyTracks, setSpotifyTracks] = useState<NormalizedTrack[]>([]);
  const [spotifyState, setSpotifyState] = useState<LoadState>("idle");
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [spotifyLastQuery, setSpotifyLastQuery] = useState("");

  // YouTube
  const [youtubeResults, setYoutubeResults] = useState<YoutubeSearchResult[]>([]);
  const [youtubeState, setYoutubeState] = useState<LoadState>("idle");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeLastQuery, setYoutubeLastQuery] = useState("");
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState(false);

  async function onSpotifySearch(q: string) {
    setSpotifyState("loading");
    setSpotifyError(null);
    setSpotifyLastQuery(q);
    try {
      const data = await apiFetch<SearchResponse>(
        `/api/spotify/search?q=${encodeURIComponent(q)}`,
      );
      setSpotifyTracks(data.tracks);
      setSpotifyState("ready");
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.status === 503 && e.retryAfter) {
        setSpotifyError(
          `Spotify is rate-limiting us — try again in ${e.retryAfter} seconds.`,
        );
      } else if (e?.status === 502 || e?.status === 503) {
        setSpotifyError("Spotify upstream error — try again in a moment.");
      } else {
        setSpotifyError(e?.message ?? "Search failed");
      }
      setSpotifyState("error");
    }
  }

  async function onYouTubeSearch(q: string) {
    setYoutubeState("loading");
    setYoutubeError(null);
    setYoutubeLastQuery(q);
    try {
      const data = await apiFetch<YoutubeSearchResponse>(
        `/api/youtube/search?q=${encodeURIComponent(q)}`,
      );
      setYoutubeResults(data.results);
      setQuota(data.quota);
      setQuotaBlocked(data.quota.remainingSearches <= 0);
      setYoutubeState("ready");
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      // Quota-safeguard 429: block the bar for the rest of the session.
      if (e?.status === 429 && e.code === "youtube_quota_safeguard") {
        const body = e.body as
          | { remainingSearches?: number; resetsAt?: string }
          | undefined;
        setQuota({
          remainingSearches: body?.remainingSearches ?? 0,
          remainingUnits: 0,
          resetsAt: body?.resetsAt ?? "",
        });
        setQuotaBlocked(true);
        setYoutubeError(
          "YouTube search limit reached for today. Resets at the next UTC midnight.",
        );
      } else if (e?.status === 502 || e?.status === 503) {
        setYoutubeError("YouTube upstream error — try again in a moment.");
      } else {
        setYoutubeError(e?.message ?? "Search failed");
      }
      setYoutubeState("error");
    }
  }

  function clearSpotify() {
    setSpotifyTracks([]);
    setSpotifyState("idle");
    setSpotifyError(null);
  }

  function clearYouTube() {
    setYoutubeResults([]);
    setYoutubeState("idle");
    setYoutubeError(null);
  }

  const youtubePlaceholder = quotaBlocked
    ? "YouTube search limit reached. Try again after the next UTC midnight."
    : "Search songs, artists, live versions… (YouTube)";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Search Spotify or YouTube</h1>

      <div className="flex flex-col gap-3">
        <SearchBar
          onSearch={onSpotifySearch}
          disabled={spotifyState === "loading"}
          placeholder="Search artists, songs, albums… (Spotify)"
          buttonClassName={SPOTIFY_BUTTON}
        />
        <SearchBar
          onSearch={onYouTubeSearch}
          disabled={youtubeState === "loading" || quotaBlocked}
          placeholder={youtubePlaceholder}
          buttonClassName={YOUTUBE_BUTTON}
          inputClassName={YOUTUBE_INPUT}
        />
        {quota && !quotaBlocked && (
          <p className="text-xs text-muted">
            YouTube searches left today: {quota.remainingSearches}
          </p>
        )}
        {quotaBlocked && quota?.resetsAt && (
          <p className="text-xs text-danger">
            YouTube search limit reached. Resets at{" "}
            {new Date(quota.resetsAt).toLocaleString()}.
          </p>
        )}
      </div>

      {/* Spotify section */}
      {spotifyState === "loading" && (
        <p className="text-sm text-muted">Searching Spotify…</p>
      )}
      {spotifyState === "error" && spotifyError && (
        <p className="rounded border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
          {spotifyError}
        </p>
      )}
      {spotifyState === "ready" && (
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Spotify results"
            count={spotifyTracks.length}
            query={spotifyLastQuery}
            onClear={clearSpotify}
          />
          {spotifyTracks.length > 0 && (
            <SearchResults tracks={spotifyTracks} playlists={playlists} />
          )}
        </section>
      )}

      {/* YouTube section */}
      {youtubeState === "loading" && (
        <p className="text-sm text-muted">Searching YouTube…</p>
      )}
      {youtubeState === "error" && youtubeError && (
        <p className="rounded border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
          {youtubeError}
        </p>
      )}
      {youtubeState === "ready" && (
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="YouTube results"
            count={youtubeResults.length}
            query={youtubeLastQuery}
            onClear={clearYouTube}
          />
          {youtubeResults.length > 0 && (
            <YouTubeSearchResults
              results={youtubeResults}
              playlists={playlists}
            />
          )}
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  query,
  onClear,
}: {
  title: string;
  count: number;
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs uppercase tracking-wide text-muted">
        {title}
        {count === 0 && query ? (
          <span className="ml-2 normal-case text-muted">
            — no results for &ldquo;{query}&rdquo;
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground"
      >
        Clear results
      </button>
    </div>
  );
}
