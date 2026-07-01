"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SearchSurface } from "@/types/api";

type Props = {
  surface: SearchSurface;
  // Bumped by the parent after it records a new search, to trigger a re-fetch.
  refreshKey: number;
  // Click a recent → populate + rerun that surface's search.
  onRerun: (q: string) => void;
};

// Recent searches shown under a specific search bar. Self-manages its own list
// (fetch + delete-one + clear-all); re-fetches on mount and whenever refreshKey
// changes (i.e. after the parent records a submitted search).
export function RecentSearches({ surface, refreshKey, onRerun }: Props) {
  const [items, setItems] = useState<string[]>([]);
  // Bumped by our own mutations (delete/clear) to re-fetch; `refreshKey` does
  // the same for parent-driven refreshes (after a search is recorded).
  const [localTick, setLocalTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ queries: string[] }>(`/api/search-history?surface=${surface}`)
      .then((data) => {
        if (!cancelled) setItems(data.queries);
      })
      .catch(() => {
        // Non-critical UI: leave the last-known list on error.
      });
    return () => {
      cancelled = true;
    };
  }, [surface, refreshKey, localTick]);

  async function removeOne(q: string) {
    try {
      await apiFetch("/api/search-history", {
        method: "DELETE",
        body: JSON.stringify({ surface, query: q }),
      });
    } catch {
      // ignore
    }
    setLocalTick((t) => t + 1);
  }

  async function clearAll() {
    try {
      await apiFetch("/api/search-history", {
        method: "DELETE",
        body: JSON.stringify({ surface, all: true }),
      });
    } catch {
      // ignore
    }
    setLocalTick((t) => t + 1);
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Recent:</span>
      {items.map((q) => (
        <span
          key={q}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
        >
          <button
            type="button"
            onClick={() => onRerun(q)}
            className="max-w-[12rem] truncate text-muted hover:text-foreground"
            title={`Search “${q}” again`}
          >
            {q}
          </button>
          <button
            type="button"
            onClick={() => removeOne(q)}
            aria-label={`Remove “${q}” from recent searches`}
            className="leading-none text-muted/70 hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}
