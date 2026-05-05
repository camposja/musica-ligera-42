"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";

type RefilterResult = {
  checked: number;
  changed: number;
  nowUnplayable: number;
  errored: number;
  capReached: boolean;
};

export function RefilterYoutubeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefilterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await apiFetch<RefilterResult>("/api/youtube/refilter-all", {
        method: "POST",
      });
      setResult(r);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Re-check failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">YouTube playback fix</p>
          <p className="text-muted text-xs">
            Re-checks songs whose YouTube match isn&rsquo;t embeddable and
            promotes a working alternate (when one exists). Costs ~1 quota unit
            per song.
          </p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="shrink-0 rounded border border-accent px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
        >
          {busy ? "Checking…" : "Re-check matches"}
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {result && (
        <p className="text-muted text-xs">
          Checked {result.checked} · fixed {result.changed} · still unplayable{" "}
          {result.nowUnplayable}
          {result.errored > 0 ? ` · errored ${result.errored}` : ""}
          {result.capReached ? " · hit per-run cap (run again for the rest)" : ""}
        </p>
      )}
    </div>
  );
}
