"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useSession } from "@/components/SessionProvider";
import type { ImportPlaylistResponse } from "@/types/api";

type ErrorView = {
  message: string;
  showConnectButton: boolean;
};

export function ImportPlaylistForm() {
  const session = useSession();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorView, setErrorView] = useState<ErrorView | null>(null);
  const [result, setResult] = useState<ImportPlaylistResponse | null>(null);

  const isOwner = session.role === "OWNER";

  function mapError(err: unknown): ErrorView {
    if (!(err instanceof ApiError)) {
      return { message: "Import failed", showConnectButton: false };
    }
    const askOwner = "Ask the OWNER to connect Spotify.";
    switch (err.code) {
      case "not_connected":
        return {
          message: isOwner
            ? "Spotify isn't connected."
            : `Spotify isn't connected. ${askOwner}`,
          showConnectButton: isOwner,
        };
      case "reconnect_required":
        return {
          message: isOwner
            ? "Spotify connection expired — reconnect."
            : `Spotify connection expired. ${askOwner}`,
          showConnectButton: isOwner,
        };
      case "playlist_not_found_or_private":
        return {
          message:
            "Playlist not found or not visible to the connected Spotify account.",
          showConnectButton: false,
        };
      case "spotify_restricted":
        return {
          message:
            "Spotify restricts this playlist (e.g. editorial / algorithmic). Try a user-created playlist.",
          showConnectButton: false,
        };
      case "rate_limited":
        return {
          message: err.retryAfter
            ? `Spotify is rate-limiting us — try again in ${err.retryAfter}s.`
            : "Spotify is rate-limiting us — try again later.",
          showConnectButton: false,
        };
      case "upstream":
        return {
          message: "Spotify upstream error — try again.",
          showConnectButton: false,
        };
      default:
        return { message: err.message || "Import failed", showConnectButton: false };
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setErrorView({
        message: "Spotify playlist URL is required",
        showConnectButton: false,
      });
      return;
    }
    setSubmitting(true);
    setErrorView(null);
    setResult(null);
    try {
      const data = await apiFetch<ImportPlaylistResponse>(
        "/api/spotify/import-playlist",
        {
          method: "POST",
          body: JSON.stringify({ url: url.trim() }),
        },
      );
      setResult(data);
      setUrl("");
      router.refresh();
    } catch (err) {
      setErrorView(mapError(err));
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
      {errorView && (
        <div className="flex items-center gap-3 text-sm">
          <p className="text-danger">{errorView.message}</p>
          {errorView.showConnectButton && (
            <a
              href="/api/spotify/connect"
              className="rounded border border-accent px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
            >
              Connect Spotify
            </a>
          )}
        </div>
      )}
      {result && (
        <p className="text-sm text-muted">
          Imported &ldquo;{result.playlist.name}&rdquo; — {result.songsImported} new,{" "}
          {result.songsReused} reused.
        </p>
      )}
    </form>
  );
}
