"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";

type Props = {
  isOwner: boolean;
  spotifyConnected: boolean;
  spotifyAccountId: string | null;
};

export function HeaderMenu({ isOwner, spotifyConnected, spotifyAccountId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      setSigningOut(false);
      console.error(err instanceof ApiError ? err.message : err);
    }
  }

  async function disconnectSpotify() {
    setDisconnecting(true);
    try {
      await apiFetch("/api/spotify/disconnect", { method: "POST" });
      router.refresh();
      setOpen(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : err);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-border px-2 py-1 text-base leading-none text-muted hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded border border-border bg-surface shadow-lg"
        >
          {isOwner && (
            <div className="border-b border-border px-4 py-3 text-xs">
              <div className="mb-2 font-medium uppercase tracking-wide text-muted">
                Spotify
              </div>
              {spotifyConnected ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-accent">
                    Connected{spotifyAccountId ? ` as ${spotifyAccountId}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={disconnectSpotify}
                    disabled={disconnecting}
                    className="shrink-0 text-muted underline hover:text-foreground disabled:opacity-50"
                  >
                    {disconnecting ? "…" : "Disconnect"}
                  </button>
                </div>
              ) : (
                <a
                  href="/api/spotify/connect"
                  className="inline-block rounded border border-accent px-2 py-1 text-accent hover:bg-accent/10"
                >
                  Connect Spotify
                </a>
              )}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            disabled={signingOut}
            className="block w-full px-4 py-3 text-left text-sm text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
