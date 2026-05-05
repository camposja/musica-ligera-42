"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";

type RematchResult = {
  checked: number;
  matchedExact: number;
  matchedLoose: number;
  stillUnmatched: number;
  errored: number;
  capReached: boolean;
};

export function FindMissingMatchesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RematchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await apiFetch<RematchResult>(
        "/api/youtube/rematch-missing",
        { method: "POST" },
      );
      setResult(r);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rematch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Find missing YouTube matches</p>
          <p className="text-muted text-xs">
            Re-runs the (looser) matcher on songs without a YouTube match.
            Caps at 50 songs per click; ~103 quota units each.
          </p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="shrink-0 rounded border border-accent px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
        >
          {busy ? "Searching…" : "Find missing matches"}
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {result && (
        <p className="text-muted text-xs">
          Checked {result.checked} · exact {result.matchedExact} · loose{" "}
          {result.matchedLoose} · still unmatched {result.stillUnmatched}
          {result.errored > 0 ? ` · errored ${result.errored}` : ""}
          {result.capReached ? " · hit per-run cap (run again for the rest)" : ""}
        </p>
      )}
    </div>
  );
}
