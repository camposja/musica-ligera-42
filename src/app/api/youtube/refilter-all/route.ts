import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refilterSongMatch, YoutubeError } from "@/lib/youtube";

// Cap how many songs we re-check per request so a single click can't burn
// the entire YouTube daily quota (10,000 units; this endpoint costs 1 unit
// per song). At 500 we use 500 units max — comfortably under quota even if
// invoked twice in a day.
const REFILTER_LIMIT = 500;

export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  const songs = await prisma.song.findMany({
    where: { youtubeId: { not: null } },
    select: { id: true },
    take: REFILTER_LIMIT,
  });

  let changed = 0;
  let nowUnplayable = 0;
  let checked = 0;
  let errored = 0;
  for (const { id } of songs) {
    try {
      const r = await refilterSongMatch(id);
      checked += 1;
      if (r.changed) changed += 1;
      if (r.nowUnplayable) nowUnplayable += 1;
    } catch (err) {
      errored += 1;
      if (err instanceof YoutubeError && err.httpStatus === 403) {
        // Quota exceeded — bail early rather than burn the rest of the day.
        return Response.json(
          {
            error: "YouTube quota exceeded — try again tomorrow",
            checked,
            changed,
            nowUnplayable,
            errored,
          },
          { status: 503 },
        );
      }
      console.error("[youtube] refilter song failed", { songId: id, err });
    }
  }

  return Response.json({
    checked,
    changed,
    nowUnplayable,
    errored,
    capReached: songs.length >= REFILTER_LIMIT,
  });
}
