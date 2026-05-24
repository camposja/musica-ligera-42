"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";

type Settings = { allowChildSpotifyLogin: boolean };

type Status = "idle" | "saving" | "error";

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function setAllowChildSpotifyLogin(next: boolean) {
    const prev = settings.allowChildSpotifyLogin;
    setSettings({ allowChildSpotifyLogin: next });
    setStatus("saving");
    setErrorMsg(null);
    try {
      const updated = await apiFetch<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ allowChildSpotifyLogin: next }),
      });
      setSettings(updated);
      setStatus("idle");
      // Refresh the layout so the header reflects the new flag immediately.
      startTransition(() => router.refresh());
    } catch (err) {
      setSettings({ allowChildSpotifyLogin: prev });
      setStatus("error");
      setErrorMsg(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor="allow-child-spotify-login"
            className="block text-sm font-medium"
          >
            Allow users to connect Spotify
          </label>
          <p className="mt-1 text-xs text-muted">
            When on, any signed-in user can connect Spotify for the whole app.
            The connection is shared — whoever connects sets the account
            everyone uses.
          </p>
        </div>
        <input
          id="allow-child-spotify-login"
          type="checkbox"
          checked={settings.allowChildSpotifyLogin}
          disabled={status === "saving"}
          onChange={(e) => setAllowChildSpotifyLogin(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
      </div>
      <div className="mt-2 h-4 text-xs">
        {status === "saving" && <span className="text-muted">Saving…</span>}
        {status === "error" && (
          <span className="text-danger">{errorMsg ?? "Save failed"}</span>
        )}
      </div>
    </section>
  );
}
