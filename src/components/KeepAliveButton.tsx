"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import {
  DURATION_MS,
  nextPingDelay,
  retryDelay,
} from "@/lib/keep-alive-schedule";

const STORAGE_KEY = "ml42:keepAlive";

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

function formatRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "0m left";
  return `${Math.ceil(ms / 60000)}m left`;
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
  // The window is "active" as soon as expiresAt is set, but we only claim
  // "Awake" once a ping has actually succeeded (lastSuccessAt). This keeps the
  // UI honest: a dead endpoint shows "Connecting…"/"Can't reach", never "Awake".
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [, forceTick] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiresAtRef = useRef<number | null>(expiresAt);
  const lastSuccessAtRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const inFlightRef = useRef(false);
  const pingRef = useRef<(isFirst: boolean) => void>(() => {});

  // Hard stop: cancel any pending timer, clear all state/refs, and (optionally)
  // wipe storage. Because expiresAtRef becomes null, every catch-up/retry/
  // in-flight continuation below early-returns — no ping can fire after stop.
  const stop = useCallback((opts: { clearStorage: boolean }) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    expiresAtRef.current = null;
    lastSuccessAtRef.current = null;
    failuresRef.current = 0;
    setExpiresAt(null);
    setLastSuccessAt(null);
    setDegraded(false);
    if (opts.clearStorage) writeStored(null);
  }, []);

  const scheduleIn = useCallback((exp: number, delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const clamped = Math.max(0, Math.min(delay, exp - Date.now()));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pingRef.current(false);
    }, clamped);
  }, []);

  const ping = useCallback(
    async (isFirst: boolean) => {
      if (inFlightRef.current) return;
      if (expiresAtRef.current === null) return; // stopped
      inFlightRef.current = true;

      let ok = false;
      try {
        await apiFetch<{ ok: true; serverTime: number }>("/api/keep-alive");
        ok = true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          inFlightRef.current = false;
          stop({ clearStorage: true });
          return;
        }
        // Non-401 (network/5xx): fall through to the retry path below.
      } finally {
        inFlightRef.current = false;
      }

      // If stopped or expired while the request was in flight, stop here — no
      // reschedule. `isFirst` is unused past this point but documents intent.
      void isFirst;
      const exp = expiresAtRef.current;
      if (exp === null) return;
      if (Date.now() >= exp) {
        stop({ clearStorage: true });
        return;
      }

      if (ok) {
        failuresRef.current = 0;
        lastSuccessAtRef.current = Date.now();
        setLastSuccessAt(lastSuccessAtRef.current);
        setDegraded(false);
        scheduleIn(exp, nextPingDelay({ now: Date.now(), expiresAt: exp }));
      } else {
        failuresRef.current += 1;
        setDegraded(true);
        scheduleIn(exp, retryDelay(failuresRef.current));
      }
    },
    [scheduleIn, stop],
  );

  useEffect(() => {
    pingRef.current = (isFirst: boolean) => {
      void ping(isFirst);
    };
  }, [ping]);

  // Adopt an expiry (from mount hydration or a cross-tab storage event) and
  // fire a confirming ping. isFirst controls only whether the "Connecting…"
  // label shows (i.e. when this tab has no prior success yet).
  const adopt = useCallback(
    (exp: number) => {
      expiresAtRef.current = exp;
      failuresRef.current = 0;
      setExpiresAt(exp);
      setDegraded(false);
      pingRef.current(lastSuccessAtRef.current === null);
    },
    [],
  );

  // Mount: if we hydrated an active expiry, fire a confirming catch-up ping.
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
          adopt(parsed.expiresAt);
        }
      } catch {
        // ignore malformed value
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adopt, stop]);

  // Catch up after the tab was hidden/backgrounded, refocused, restored from
  // bfcache, or the network came back. Guards on "still active" so a stopped
  // window can never resurrect a ping.
  useEffect(() => {
    function maybeCatchUp() {
      const exp = expiresAtRef.current;
      if (exp === null) return;
      if (Date.now() >= exp) {
        stop({ clearStorage: true });
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (!inFlightRef.current) void ping(false);
    }
    document.addEventListener("visibilitychange", maybeCatchUp);
    window.addEventListener("pageshow", maybeCatchUp);
    window.addEventListener("focus", maybeCatchUp);
    window.addEventListener("online", maybeCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", maybeCatchUp);
      window.removeEventListener("pageshow", maybeCatchUp);
      window.removeEventListener("focus", maybeCatchUp);
      window.removeEventListener("online", maybeCatchUp);
    };
  }, [ping, stop]);

  // Re-render periodically so the "Nm left" label decrements.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30 * 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // Start a fresh 60-min window, or — if already active — restart/extend it back
  // to a full 60 min from now. Either way, ping immediately to (re)confirm warmth.
  function startOrExtend() {
    const exp = Date.now() + DURATION_MS;
    const wasActive = expiresAtRef.current !== null;
    writeStored({ expiresAt: exp });
    expiresAtRef.current = exp;
    failuresRef.current = 0;
    setExpiresAt(exp);
    setDegraded(false);
    if (!wasActive) {
      lastSuccessAtRef.current = null;
      setLastSuccessAt(null);
    }
    pingRef.current(!wasActive);
  }

  if (expiresAt === null) {
    return (
      <button
        type="button"
        onClick={startOrExtend}
        title="Keep this site warm for 60 minutes while this tab stays open and awake"
        className="shrink-0 rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground"
      >
        Keep awake
      </button>
    );
  }

  const connecting = lastSuccessAt === null && !degraded;
  const label = connecting
    ? "Connecting…"
    : lastSuccessAt === null
      ? "Can't reach — retrying"
      : `Awake · ${formatRemaining(expiresAt)}${degraded ? " ⚠" : ""}`;
  const title = connecting
    ? "Reaching the server…"
    : lastSuccessAt === null
      ? "Couldn't reach the server — retrying"
      : degraded
        ? "Last ping failed — retrying (window still active)"
        : "Keeping this site warm";

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span
        className={`rounded border px-2 py-1 text-sm ${
          degraded || lastSuccessAt === null
            ? "border-danger/50 text-danger"
            : "border-accent text-accent"
        }`}
        title={title}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={startOrExtend}
        title="Reset the window to a fresh 60 minutes"
        className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground"
      >
        Extend
      </button>
      <button
        type="button"
        onClick={() => stop({ clearStorage: true })}
        className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground"
      >
        Stop
      </button>
    </div>
  );
}
