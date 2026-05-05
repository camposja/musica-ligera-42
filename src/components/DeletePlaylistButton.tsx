"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";

const REQUIRED = "confirm delete";

type Props = { playlistId: string };

export function DeletePlaylistButton({ playlistId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = text.trim().toLowerCase() === REQUIRED;

  async function confirm() {
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/playlists/${playlistId}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: text }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-danger sm:text-sm"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 rounded border border-danger/40 bg-background px-3 py-2 text-xs">
      <div className="text-danger">
        This permanently deletes the playlist. Type{" "}
        <span className="font-mono">{REQUIRED}</span> to continue.
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          disabled={busy}
          aria-label="Delete confirmation"
          className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-danger"
          placeholder={REQUIRED}
        />
        <button
          type="button"
          onClick={confirm}
          disabled={!matches || busy}
          className="rounded border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setError(null);
          }}
          disabled={busy}
          className="rounded border border-border px-3 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
