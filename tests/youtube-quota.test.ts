import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_DAILY = process.env.YOUTUBE_DAILY_QUOTA_UNITS;
const ORIGINAL_SAFETY = process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS;

afterEach(() => {
  process.env.YOUTUBE_DAILY_QUOTA_UNITS = ORIGINAL_DAILY;
  process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = ORIGINAL_SAFETY;
});

import { clearCookies, prisma, truncateAll } from "./helpers";
import {
  checkQuota,
  consumeQuota,
  getQuotaStatus,
  markQuotaExhausted,
  nextResetAt,
  SEARCH_UNIT_COST,
  utcDayKey,
} from "@/lib/youtube-quota";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  // Reset env to small values so tests don't need to consume thousands of
  // units to exercise the safeguard path.
  process.env.YOUTUBE_DAILY_QUOTA_UNITS = "1000";
  process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = "500";
});

describe("utcDayKey", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    expect(utcDayKey(new Date(Date.UTC(2026, 4, 6, 12, 0, 0)))).toBe(
      "2026-05-06",
    );
  });

  it("rolls over at UTC midnight", () => {
    expect(utcDayKey(new Date(Date.UTC(2026, 4, 6, 23, 59, 59)))).toBe(
      "2026-05-06",
    );
    expect(utcDayKey(new Date(Date.UTC(2026, 4, 7, 0, 0, 0)))).toBe(
      "2026-05-07",
    );
  });
});

describe("nextResetAt", () => {
  it("returns the next UTC midnight ISO string", () => {
    const now = new Date(Date.UTC(2026, 4, 6, 18, 30));
    expect(nextResetAt(now)).toBe("2026-05-07T00:00:00.000Z");
  });
});

describe("checkQuota / consumeQuota", () => {
  it("fresh day starts with full budget", async () => {
    const r = await checkQuota(SEARCH_UNIT_COST);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.remainingUnits).toBe(500);
      expect(r.remainingSearches).toBe(Math.floor(500 / SEARCH_UNIT_COST));
    }
  });

  it("consumeQuota increments today's row", async () => {
    await consumeQuota(SEARCH_UNIT_COST);
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(500 - SEARCH_UNIT_COST);
  });

  it("multiple consumeQuota calls accumulate", async () => {
    await consumeQuota(100);
    await consumeQuota(50);
    await consumeQuota(25);
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(500 - 175);
  });

  it("checkQuota rejects when projected use exceeds safety cap", async () => {
    await consumeQuota(450);
    const r = await checkQuota(SEARCH_UNIT_COST); // would push to 553
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("safeguard_hit");
      expect(r.remainingSearches).toBe(0);
    }
  });

  it("checkQuota allows the borderline case (used + cost == cap)", async () => {
    await consumeQuota(500 - SEARCH_UNIT_COST); // 397 used, cap 500
    const r = await checkQuota(SEARCH_UNIT_COST); // 397 + 103 = 500
    expect(r.ok).toBe(true);
  });
});

describe("markQuotaExhausted", () => {
  it("forces remaining to 0 even with prior small use", async () => {
    await consumeQuota(50);
    await markQuotaExhausted();
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(0);
    expect(status.remainingSearches).toBe(0);
  });

  it("creates today's row if none existed yet", async () => {
    await markQuotaExhausted();
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(0);
  });
});

describe("day isolation", () => {
  it("yesterday's usage doesn't affect today", async () => {
    // Insert a manual yesterday row directly so we can assert isolation.
    await prisma.apiQuotaUsage.create({
      data: { service: "youtube", day: "2020-01-01", unitsUsed: 9999 },
    });
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(500); // today has nothing yet
  });
});

describe("env defaults", () => {
  it("uses defaults when env vars unset", async () => {
    delete process.env.YOUTUBE_DAILY_QUOTA_UNITS;
    delete process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS;
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(8000); // default safety cap
  });

  it("ignores nonsensical env values and falls back to defaults", async () => {
    process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = "not-a-number";
    const status = await getQuotaStatus();
    expect(status.remainingUnits).toBe(8000);
  });
});
