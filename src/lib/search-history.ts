import { prisma } from "@/lib/prisma";
import type { SearchSurface } from "@/types/api";
import { normalizeQuery } from "@/lib/youtube-search-cache";

export type { SearchSurface };

// Per-user, per-surface recent-searches store. Mirrors the iOS behavior
// (dedupe → move-to-top, capped list, most-recent-first) but keeps a `surface`
// so each of the web's search bars has its own history.

export const SEARCH_SURFACES: readonly SearchSurface[] = [
  "library",
  "spotify",
  "youtube",
];

// How many recent searches to keep per (user, surface).
export const MAX_HISTORY = 15;

export function isSearchSurface(v: unknown): v is SearchSurface {
  return typeof v === "string" && SEARCH_SURFACES.includes(v as SearchSurface);
}

// Record a submitted, non-empty search. Upserts on (userId, surface,
// normalizedQuery): an existing entry is bumped to `now` (moves to top) and its
// display casing refreshed; then the list is pruned to the newest MAX_HISTORY.
export async function recordSearch(
  userId: string,
  surface: SearchSurface,
  query: string,
): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return;
  const normalizedQuery = normalizeQuery(trimmed);
  if (normalizedQuery.length === 0) return;

  await prisma.searchHistory.upsert({
    where: { userId_surface_normalizedQuery: { userId, surface, normalizedQuery } },
    create: { userId, surface, query: trimmed, normalizedQuery },
    update: { query: trimmed, createdAt: new Date() },
  });

  // Prune everything past the newest MAX_HISTORY for this (user, surface).
  const keep = await prisma.searchHistory.findMany({
    where: { userId, surface },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    take: MAX_HISTORY,
  });
  await prisma.searchHistory.deleteMany({
    where: { userId, surface, id: { notIn: keep.map((r) => r.id) } },
  });
}

// Most-recent-first display strings for a (user, surface).
export async function listRecent(
  userId: string,
  surface: SearchSurface,
  limit = MAX_HISTORY,
): Promise<string[]> {
  const rows = await prisma.searchHistory.findMany({
    where: { userId, surface },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 0), MAX_HISTORY),
    select: { query: true },
  });
  return rows.map((r) => r.query);
}

// Delete one entry (matched by its normalized form, so it works whether the
// caller passes the display string or a normalized one).
export async function deleteSearch(
  userId: string,
  surface: SearchSurface,
  query: string,
): Promise<void> {
  await prisma.searchHistory.deleteMany({
    where: { userId, surface, normalizedQuery: normalizeQuery(query) },
  });
}

// Clear all history for a (user, surface).
export async function clearHistory(
  userId: string,
  surface: SearchSurface,
): Promise<void> {
  await prisma.searchHistory.deleteMany({ where: { userId, surface } });
}
