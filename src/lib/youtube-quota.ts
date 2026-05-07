/**
 * Daily quota ledger for the shared YouTube Data API budget.
 *
 * Three callers share the same Google API key (`/api/youtube/search`,
 * `matchSongById`, `/api/youtube/rematch-missing`); without coordination, any
 * one of them could blow through the 10K-unit free daily quota. This module
 * is the single coordination point — every quota-consuming code path:
 *
 *   1. await checkQuota(units)          — confirm headroom before calling
 *   2. await consumeQuota(units)        — charge the ledger up-front (Google
 *                                          bills per request *attempt*)
 *   3. make the YouTube API call
 *   4. on Google 403 → markQuotaExhausted() (defensive lockout)
 *
 * We never query Google for remaining quota — track locally based on known
 * unit costs (search.list = 100, videos.list = 3, total ~103 per "search").
 *
 * Day key is YYYY-MM-DD in UTC. Operator-region drift is acceptable; the cap
 * is a safety bound, not a precise mirror of Google's reset.
 */

import { prisma } from "@/lib/prisma";

const SERVICE = "youtube";

export const SEARCH_UNIT_COST = 103; // search.list (100) + videos.list (3)

function defaultDailyCap(): number {
  const v = Number(process.env.YOUTUBE_DAILY_QUOTA_UNITS);
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}
function defaultSafetyCap(): number {
  const v = Number(process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS);
  return Number.isFinite(v) && v > 0 ? v : 8_000;
}

/** Returns today's UTC date as YYYY-MM-DD. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO timestamp at the next UTC midnight from `now`. */
export function nextResetAt(now: Date = new Date()): string {
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return tomorrow.toISOString();
}

export type QuotaCheckResult =
  | {
      ok: true;
      remainingUnits: number;
      remainingSearches: number;
      resetsAt: string;
    }
  | {
      ok: false;
      reason: "safeguard_hit";
      remainingUnits: 0;
      remainingSearches: 0;
      resetsAt: string;
    };

async function readUsedUnits(day: string): Promise<number> {
  const row = await prisma.apiQuotaUsage.findUnique({
    where: { service_day: { service: SERVICE, day } },
  });
  return row?.unitsUsed ?? 0;
}

/**
 * Check whether `units` more units would exceed the safety cap. Does NOT
 * mutate the ledger. Caller must follow with `consumeQuota` before the
 * upstream call.
 */
export async function checkQuota(units: number): Promise<QuotaCheckResult> {
  const day = utcDayKey();
  const safetyCap = defaultSafetyCap();
  const used = await readUsedUnits(day);
  const projected = used + units;
  const resetsAt = nextResetAt();
  if (projected > safetyCap) {
    return {
      ok: false,
      reason: "safeguard_hit",
      remainingUnits: 0,
      remainingSearches: 0,
      resetsAt,
    };
  }
  const remainingUnits = safetyCap - used;
  return {
    ok: true,
    remainingUnits,
    remainingSearches: Math.floor(remainingUnits / SEARCH_UNIT_COST),
    resetsAt,
  };
}

/**
 * Atomically increment today's ledger by `units`. Idempotent on
 * (service, day) — uses upsert. Charge BEFORE making the call (Google bills
 * per attempt regardless of success/failure).
 */
export async function consumeQuota(units: number): Promise<void> {
  const day = utcDayKey();
  await prisma.apiQuotaUsage.upsert({
    where: { service_day: { service: SERVICE, day } },
    create: { service: SERVICE, day, unitsUsed: units },
    update: { unitsUsed: { increment: units } },
  });
}

/**
 * Defensive lockout: fast-forward today's row to the safety cap. Called when
 * Google returns 403/quota — even if our ledger thought we had room, the
 * upstream says no; lock out the rest of the day so we don't keep hitting
 * the API for nothing.
 */
export async function markQuotaExhausted(): Promise<void> {
  const day = utcDayKey();
  const safetyCap = defaultSafetyCap();
  await prisma.apiQuotaUsage.upsert({
    where: { service_day: { service: SERVICE, day } },
    create: { service: SERVICE, day, unitsUsed: safetyCap },
    update: { unitsUsed: safetyCap },
  });
}

export type QuotaStatus = {
  remainingUnits: number;
  remainingSearches: number;
  resetsAt: string;
};

/** Lightweight read for UI display. */
export async function getQuotaStatus(): Promise<QuotaStatus> {
  const day = utcDayKey();
  const safetyCap = defaultSafetyCap();
  const used = await readUsedUnits(day);
  const remainingUnits = Math.max(0, safetyCap - used);
  return {
    remainingUnits,
    remainingSearches: Math.floor(remainingUnits / SEARCH_UNIT_COST),
    resetsAt: nextResetAt(),
  };
}
