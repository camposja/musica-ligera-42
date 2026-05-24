/**
 * Day-scoped cache for YouTube search results.
 *
 * The same `(artist, title)` searched twice in one UTC day used to cost
 * 206 quota units (103 × 2). With this cache, the second search costs 0.
 *
 * Keying:
 *   - day: YYYY-MM-DD UTC, same shape as the quota ledger so they roll over
 *     together.
 *   - normalizedQuery: trim + lowercase + collapse internal whitespace. We
 *     deliberately do NOT strip punctuation; "Track" and "Track (Live)" must
 *     stay distinct.
 *
 * Only successful, non-empty payloads are cached. Errors and zero-result
 * responses go in cold every time so a transient blip isn't pinned for the
 * day. Force-refresh paths (e.g. "Rerun auto-match") bypass the cache so a
 * wrong cached match isn't stuck for 24 hours.
 *
 * GC: each `store` call deletes rows older than `RETENTION_DAYS`. No cron
 * needed — at typical write volume the GC is essentially free.
 */

import type { YoutubeSearchResult } from "@/types/api";
import { prisma } from "@/lib/prisma";
import { utcDayKey } from "@/lib/youtube-quota";

const RETENTION_DAYS = 7;

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function cacheLookup(
  query: string,
  day: string = utcDayKey(),
): Promise<YoutubeSearchResult[] | null> {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) return null;
  const row = await prisma.youtubeSearchCache.findUnique({
    where: { day_normalizedQuery: { day, normalizedQuery } },
    select: { payloadJson: true },
  });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payloadJson) as YoutubeSearchResult[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    // Malformed row — pretend it's a miss; will be overwritten on next store.
    return null;
  }
}

export async function cacheStore(
  query: string,
  results: YoutubeSearchResult[],
  day: string = utcDayKey(),
): Promise<void> {
  // Don't cache empty result sets — we'd rather pay another 103 next time
  // than pin a transient zero-results miss for the rest of the day.
  if (results.length === 0) return;
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) return;
  const payloadJson = JSON.stringify(results);

  // upsert is idempotent on (day, normalizedQuery); a force-refresh that
  // re-stores a different payload simply overwrites the row.
  await prisma.youtubeSearchCache.upsert({
    where: { day_normalizedQuery: { day, normalizedQuery } },
    create: { day, normalizedQuery, payloadJson },
    update: { payloadJson },
  });

  // Best-effort GC. Failure here doesn't fail the search.
  try {
    await purgeOldRows();
  } catch {
    // swallowed by design
  }
}

export async function purgeOldRows(
  retentionDays: number = RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const r = await prisma.youtubeSearchCache.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return r.count;
}
