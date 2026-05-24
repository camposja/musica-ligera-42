"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";

const STORAGE_KEY = "ml42:keepAlive";
const DURATION_MS = 60 * 60 * 1000;
const INTERVAL_MS = 3 * 60 * 1000;
const JITTER_MS = 10 * 1000;

type Stored = { expiresAt: number };

function readStored(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.expiresAt !== "number") return null;
    return { expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null) {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function nextDelay(expiresAt: number): number {
  const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_MS);
  const base = INTERVAL_MS + jitter;
  const remaining = expiresAt - Date.now();
  return Math.max(0, Math.min(base, remaining));
}

function formatRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "0m left";
  const minutes = Math.ceil(ms / 60000);
  return `${minutes}m left`;
}

export function KeepAliveButton() {
  const [expiresAt, setExpiresAt] = useState<number | null>(() => {
    const stored = readStored();
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      writeStored(null);
      return null;
    }
    return stored.expiresAt;
  });
  const [waking, setWaking] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [, forceTick] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiresAtRef = useRef<number | null>(expiresAt);
  const inFlightRef = useRef(false);
  const pingRef = useRef<(isFirst: boolean) => void>(() => {});

  const stop = useCallback((opts: { clearStorage: boolean }) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    expiresAtRef.current = null;
    setExpiresAt(null);
    setWaking(false);
    setDegraded(false);
    if (opts.clearStorage) writeStored(null);
  }, []);

  const schedule = useCallback((exp: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = nextDelay(exp);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pingRef.current(false);
    }, delay);
  }, []);

  const ping = useCallback(
    async (isFirst: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (isFirst) setWaking(true);

      try {
        await apiFetch<{ ok: true; serverTime: number }>("/api/keep-alive");
        setDegraded(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          stop({ clearStorage: true });
          return;
        }
        setDegraded(true);
      } finally {
        inFlightRef.current = false;
        if (isFirst) setWaking(false);
      }

      const exp = expiresAtRef.current;
      if (exp === null) return;
      if (Date.now() >= exp) {
        stop({ clearStorage: true });
        return;
      }
      schedule(exp);
    },
    [schedule, stop],
  );

  useEffect(() => {
    pingRef.current = (isFirst: boolean) => {
      void ping(isFirst);
    };
  }, [ping]);

  const activate = useCallback(
    (exp: number, opts: { firstPing: boolean }) => {
      expiresAtRef.current = exp;
      setExpiresAt(exp);
      setDegraded(false);
      if (opts.firstPing) void ping(true);
      else schedule(exp);
    },
    [ping, schedule],
  );

  // Mount: if we hydrated an active expiry, fire the catch-up ping.
  useEffect(() => {
    if (expiresAtRef.current !== null) {
      pingRef.current(true);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Cross-tab sync: another tab may start, extend, or stop keep-alive.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === null) {
        stop({ clearStorage: false });
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue) as Partial<Stored>;
        if (typeof parsed.expiresAt !== "number") return;
        if (parsed.expiresAt <= Date.now()) {
          stop({ clearStorage: false });
          return;
        }
        if (parsed.expiresAt !== expiresAtRef.current) {
          activate(parsed.expiresAt, { firstPing: false });
        }
      } catch {
        // ignore malformed value
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activate, stop]);

  // Visibility / pageshow: catch up if we drifted while hidden.
  useEffect(() => {
    function maybeCatchUp() {
      const exp = expiresAtRef.current;
      if (exp === null) return;
      if (Date.now() >= exp) {
        stop({ clearStorage: true });
        return;
      }
      if (document.visibilityState === "visible") {
        // Skip if a ping is already running; otherwise fire immediately.
        if (!inFlightRef.current) void ping(false);
      }
    }
    document.addEventListener("visibilitychange", maybeCatchUp);
    window.addEventListener("pageshow", maybeCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", maybeCatchUp);
      window.removeEventListener("pageshow", maybeCatchUp);
    };
  }, [ping, stop]);

  // Re-render once a minute so the "Nm left" label decrements.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30 * 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  function onStart() {
    const exp = Date.now() + DURATION_MS;
    writeStored({ expiresAt: exp });
    activate(exp, { firstPing: true });
  }

  function onStop() {
    stop({ clearStorage: true });
  }

  if (expiresAt === null) {
    return (
      <button
        type="button"
        onClick={onStart}
        title="Keeps this site warm while this tab stays open"
        className="shrink-0 rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground"
      >
        Keep awake
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span
        className="rounded border border-accent px-2 py-1 text-sm text-accent"
        title={
          waking
            ? "Waking the server…"
            : degraded
              ? "Last ping failed — retrying"
              : "Keeping this site warm"
        }
      >
        {waking ? "Waking…" : `Awake · ${formatRemaining(expiresAt)}`}
        {degraded && !waking ? " ⚠" : ""}
      </span>
      <button
        type="button"
        onClick={onStop}
        className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground"
      >
        Stop
      </button>
    </div>
  );
}
