import { describe, expect, it } from "vitest";
import {
  DURATION_MISMATCH_RATIO,
  END_GRACE_SEC,
  MIN_AUTHORITATIVE_SEC,
  shouldForceEnd,
} from "@/lib/playback/duration-guard";

// Canonical repro: a 213s song whose fMP4 header double-counts to ~426s.
const AUTH = 213;
const DOUBLED = 426;

describe("shouldForceEnd", () => {
  it("fires on a ~2x misread once playback passes authoritative + grace", () => {
    expect(
      shouldForceEnd({
        authoritativeSec: AUTH,
        browserDurationSec: DOUBLED,
        currentTimeSec: AUTH + END_GRACE_SEC,
      }),
    ).toBe(true);
  });

  it("does not fire before authoritative + grace", () => {
    expect(
      shouldForceEnd({
        authoritativeSec: AUTH,
        browserDurationSec: DOUBLED,
        currentTimeSec: AUTH + END_GRACE_SEC - 0.1,
      }),
    ).toBe(false);
  });

  it("ratio boundary: 1.69x never fires, 1.71x does", () => {
    const base = {
      authoritativeSec: 100,
      currentTimeSec: 100 + END_GRACE_SEC,
    };
    expect(shouldForceEnd({ ...base, browserDurationSec: 169 })).toBe(false);
    expect(shouldForceEnd({ ...base, browserDurationSec: 171 })).toBe(true);
    // Exactly at the ratio is NOT a mismatch (strict >).
    expect(
      shouldForceEnd({ ...base, browserDurationSec: 100 * DURATION_MISMATCH_RATIO }),
    ).toBe(false);
  });

  it("never fires without an authoritative duration", () => {
    for (const authoritativeSec of [null, undefined, 0]) {
      expect(
        shouldForceEnd({
          authoritativeSec,
          browserDurationSec: DOUBLED,
          currentTimeSec: 9999,
        }),
      ).toBe(false);
    }
  });

  it("never fires for authoritative durations under the floor", () => {
    expect(
      shouldForceEnd({
        authoritativeSec: MIN_AUTHORITATIVE_SEC - 1,
        browserDurationSec: 500,
        currentTimeSec: 400,
      }),
    ).toBe(false);
  });

  it("never fires on a healthy stream (browser agrees with authoritative)", () => {
    expect(
      shouldForceEnd({
        authoritativeSec: AUTH,
        browserDurationSec: AUTH + 1, // normal rounding drift
        currentTimeSec: AUTH + 10, // even past the end
      }),
    ).toBe(false);
  });

  it("never fires while the browser duration is unknown (NaN/Infinity/0)", () => {
    for (const browserDurationSec of [NaN, Infinity, 0, -1]) {
      expect(
        shouldForceEnd({
          authoritativeSec: AUTH,
          browserDurationSec,
          currentTimeSec: AUTH + 10,
        }),
      ).toBe(false);
    }
  });
});
