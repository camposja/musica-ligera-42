import { describe, expect, it } from "vitest";
import {
  INTERVAL_MS,
  JITTER_MS,
  nextPingDelay,
  retryDelay,
} from "@/lib/keep-alive-schedule";

describe("nextPingDelay", () => {
  const now = 1_000_000;
  const farExpiry = now + 60 * 60 * 1000; // an hour out — never the clamp

  it("centers on INTERVAL_MS with rand=0.5 (no jitter)", () => {
    expect(nextPingDelay({ now, expiresAt: farExpiry }, () => 0.5)).toBe(INTERVAL_MS);
  });

  it("applies negative jitter at rand=0 and positive at rand≈1", () => {
    expect(nextPingDelay({ now, expiresAt: farExpiry }, () => 0)).toBe(
      INTERVAL_MS - JITTER_MS,
    );
    // rand→1 gives +JITTER_MS - 1 (floor of (2*~1-1)*JITTER); allow the boundary.
    const hi = nextPingDelay({ now, expiresAt: farExpiry }, () => 0.999999);
    expect(hi).toBeGreaterThan(INTERVAL_MS + JITTER_MS - 2);
    expect(hi).toBeLessThanOrEqual(INTERVAL_MS + JITTER_MS);
  });

  it("stays within ±JITTER_MS of INTERVAL_MS across the random range", () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const d = nextPingDelay({ now, expiresAt: farExpiry }, () => r);
      expect(d).toBeGreaterThanOrEqual(INTERVAL_MS - JITTER_MS);
      expect(d).toBeLessThanOrEqual(INTERVAL_MS + JITTER_MS);
    }
  });

  it("clamps to remaining time when expiry is near", () => {
    const nearExpiry = now + 5_000; // only 5s left
    expect(nextPingDelay({ now, expiresAt: nearExpiry }, () => 0.5)).toBe(5_000);
  });

  it("never returns negative once expired", () => {
    expect(nextPingDelay({ now, expiresAt: now - 1_000 }, () => 0.5)).toBe(0);
  });

  it("respects injected interval/jitter overrides", () => {
    expect(
      nextPingDelay(
        { now, expiresAt: farExpiry, intervalMs: 120_000, jitterMs: 0 },
        () => 0.5,
      ),
    ).toBe(120_000);
  });
});

describe("retryDelay", () => {
  it("backs off 15s → 30s → 60s and caps at 60s", () => {
    expect(retryDelay(1)).toBe(15_000);
    expect(retryDelay(2)).toBe(30_000);
    expect(retryDelay(3)).toBe(60_000);
    expect(retryDelay(4)).toBe(60_000);
    expect(retryDelay(99)).toBe(60_000);
  });

  it("treats 0/negative as the first step", () => {
    expect(retryDelay(0)).toBe(15_000);
    expect(retryDelay(-5)).toBe(15_000);
  });
});
