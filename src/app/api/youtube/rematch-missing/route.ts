import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchSongById, YoutubeError } from "@/lib/youtube";

// Per-run caps. Each match call costs ~103 quota units (search 100 + videos 3).
//
// REMATCH_LIMIT is the song cap (DB query bound).
// REMATCH_SEARCH_BUDGET is the hard quota safety: stop after this many
// search.list invocations regardless of song count. Today each song uses
// exactly one search, so the budget bites only as a redundant safety. If a
// future change ever adds query fan-out per song, this cap prevents one click
// from blowing the daily 10,000-unit free quota.
const REMATCH_LIMIT = 50;
const REMATCH_SEARCH_BUDGET = 80;

export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  const songs = await prisma.song.findMany({
    where: { youtubeId: null },
    select: { id: true },
    take: REMATCH_LIMIT,
  });

  let checked = 0;
  let matchedExact = 0;
  let matchedLoose = 0;
  let stillUnmatched = 0;
  let errored = 0;
  let searchesUsed = 0;
  let quotaCapReached = false;

  for (const { id } of songs) {
    if (searchesUsed >= REMATCH_SEARCH_BUDGET) {
      quotaCapReached = true;
      break;
    }
    checked += 1;
    // matchSongById currently issues exactly one search; if that ever changes,
    // the budget still protects the daily quota.
    searchesUsed += 1;
    try {
      const out = await matchSongById(id);
      if (out.matched) {
        if (out.type === "exact") matchedExact += 1;
        else matchedLoose += 1;
      } else {
        // Shouldn't normally happen — we filtered to youtubeId:null — but be
        // defensive in case of a race with another match path.
        stillUnmatched += 1;
      }
    } catch (err) {
      if (err instanceof YoutubeError) {
        if (err.httpStatus === 404) {
          // Genuinely no match — leave the song with youtubeId null.
          stillUnmatched += 1;
          continue;
        }
        if (err.httpStatus === 403) {
          // Quota exceeded — bail early rather than burn the rest of the day.
          return Response.json(
            {
              error: "YouTube quota exceeded — try again tomorrow",
              checked,
              matchedExact,
              matchedLoose,
              stillUnmatched,
              errored,
            },
            { status: 503 },
          );
        }
      }
      errored += 1;
      console.error("[youtube] rematch failed", { songId: id, err });
    }
  }

  return Response.json({
    checked,
    matchedExact,
    matchedLoose,
    stillUnmatched,
    errored,
    capReached: songs.length >= REMATCH_LIMIT,
    quotaCapReached,
  });
}
