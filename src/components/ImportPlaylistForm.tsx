"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ImportPlaylistResponse } from "@/types/api";

export function ImportPlaylistForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportPlaylistResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setError("Spotify playlist URL is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<ImportPlaylistResponse>("/api/spotify/import-playlist", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      setUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="text-sm font-medium">Import from Spotify</label>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://open.spotify.com/playlist/…"
          className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
        >
          {submitting ? "Importing…" : "Import"}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <p className="text-sm text-muted">
          Imported &ldquo;{result.playlist.name}&rdquo; — {result.songsImported} new,{" "}
          {result.songsReused} reused.
        </p>
      )}
    </form>
  );
}
