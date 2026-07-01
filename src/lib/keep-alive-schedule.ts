// Pure scheduling math for the Keep Awake pinger. No DOM/timers/state here so it
// can be unit-tested in isolation.

export const DURATION_MS = 60 * 60 * 1000; // temporary 60-min warm window
export const INTERVAL_MS = 3 * 60 * 1000; // normal cadence between pings
export const JITTER_MS = 10 * 1000; // ±10s so multiple tabs/users don't sync up

// Delay until the next normal-cadence ping: INTERVAL_MS ± jitter, clamped to the
// time remaining in the window (never negative, never past expiry). `rand`
// defaults to Math.random but is injectable for deterministic tests.
export function nextPingDelay(
  opts: { now: number; expiresAt: number; intervalMs?: number; jitterMs?: number },
  rand: () => number = Math.random,
): number {
  const intervalMs = opts.intervalMs ?? INTERVAL_MS;
  const jitterMs = opts.jitterMs ?? JITTER_MS;
  const jitter = Math.floor((rand() * 2 - 1) * jitterMs);
  const base = intervalMs + jitter;
  const remaining = opts.expiresAt - opts.now;
  return Math.max(0, Math.min(base, remaining));
}

// Backoff delay after `failures` consecutive failed pings (1-based): 15s → 30s →
// 60s, then capped at 60s. Lets a transient failure recover far faster than the
// normal ~3-min cadence without turning into aggressive polling.
export function retryDelay(failures: number): number {
  const steps = [15_000, 30_000, 60_000];
  const idx = Math.min(Math.max(failures, 1), steps.length) - 1;
  return steps[idx];
}
