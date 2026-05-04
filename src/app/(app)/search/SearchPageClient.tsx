"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import type { NormalizedTrack, SearchResponse } from "@/types/api";

type PlaylistOption = { id: string; name: string };
type LoadState = "idle" | "loading" | "ready" | "error";

type Props = { playlists: PlaylistOption[] };

export function SearchPageClient({ playlists }: Props) {
  const [tracks, setTracks] = useState<NormalizedTrack[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");

  async function onSearch(q: string) {
    setState("loading");
    setError(null);
    setLastQuery(q);
    try {
      const data = await apiFetch<SearchResponse>(
        `/api/spotify/search?q=${encodeURIComponent(q)}`,
      );
      setTracks(data.tracks);
      setState("ready");
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.status === 503 && e.retryAfter) {
        setError(
          `Spotify is rate-limiting us — try again in ${e.retryAfter} seconds.`,
        );
      } else if (e?.status === 502 || e?.status === 503) {
        setError("Spotify upstream error — try again in a moment.");
      } else {
        setError(e?.message ?? "Search failed");
      }
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Search Spotify</h1>
      <SearchBar onSearch={onSearch} disabled={state === "loading"} />
      {state === "loading" && <p className="text-sm text-muted">Searching…</p>}
      {state === "error" && error && (
        <p className="rounded border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {state === "ready" && tracks.length === 0 && (
        <p className="text-sm text-muted">
          No results for &ldquo;{lastQuery}&rdquo;.
        </p>
      )}
      {state === "ready" && tracks.length > 0 && (
        <SearchResults tracks={tracks} playlists={playlists} />
      )}
    </div>
  );
}
