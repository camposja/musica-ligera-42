import { prisma } from "@/lib/prisma";
import type { LyricsLookup } from "./types";

type Status = "found" | "instrumental" | "not_found";

// Per-status retention. found/instrumental are stable for ~30d; not_found is
// rechecked sooner because a track may gain lyrics on LRCLIB later.
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS: Record<Status, number> = {
  found: 30 * DAY_MS,
  instrumental: 30 * DAY_MS,
  not_found: 2 * DAY_MS,
};

function isStatus(s: string): s is Status {
  return s === "found" || s === "instrumental" || s === "not_found";
}

function toLookup(status: Status, lyrics: string): LyricsLookup {
  if (status === "found") return { kind: "found", lyrics };
  if (status === "instrumental") return { kind: "instrumental" };
  return { kind: "not_found" };
}

// Returns a cached outcome only if a row exists AND is within its per-status
// TTL; a stale row reads as a miss (null) so the caller re-fetches.
export async function lookup(cacheKey: string): Promise<LyricsLookup | null> {
  const row = await prisma.lyricsCache.findUnique({ where: { cacheKey } });
  if (!row || !isStatus(row.status)) return null;
  const fresh = Date.now() - row.createdAt.getTime() <= TTL_MS[row.status];
  if (!fresh) return null;
  return toLookup(row.status, row.lyrics);
}

export async function record(cacheKey: string, result: LyricsLookup): Promise<void> {
  const status: Status = result.kind;
  const lyrics = result.kind === "found" ? result.lyrics : "";
  await prisma.lyricsCache.upsert({
    where: { cacheKey },
    create: { cacheKey, status, lyrics },
    // Reset createdAt so the TTL clock restarts on re-record.
    update: { status, lyrics, createdAt: new Date() },
  });
  // Best-effort opportunistic GC. Failure here must not fail the request.
  try {
    await prune();
  } catch {
    // swallowed by design
  }
}

// Delete rows past their per-status TTL. Returns the number removed.
export async function prune(): Promise<number> {
  const now = Date.now();
  const res = await prisma.$transaction(
    (Object.keys(TTL_MS) as Status[]).map((status) =>
      prisma.lyricsCache.deleteMany({
        where: { status, createdAt: { lt: new Date(now - TTL_MS[status]) } },
      }),
    ),
  );
  return res.reduce((n, r) => n + r.count, 0);
}
