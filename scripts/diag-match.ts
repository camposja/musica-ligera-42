/**
 * Diagnostic: run a song's title+artist through the current matcher and
 * print every candidate + score, so we can decide whether failures are
 *   (A) the right video isn't in the search results, or
 *   (B) it is, but the scorer is rejecting it.
 *
 * Usage:
 *   YOUTUBE_API_KEY=xxx node --experimental-strip-types scripts/diag-match.ts
 *
 * Hard-coded with the two known failing examples. Edit `CASES` to add more.
 *
 * No DB / Prisma dependency on purpose — this is a pure scoring probe.
 */

import {
  pickBestMatch,
  scoreCandidate,
  type Candidate,
  type SongMeta,
} from "../src/lib/youtube-match";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

type Case = { song: SongMeta; expectedIds: string[]; queries?: string[] };

const CASES: Case[] = [
  {
    song: { title: "Promiscuità", artist: "Thegiornalisti" },
    expectedIds: ["CsJdM44c9Xo"],
  },
  {
    song: { title: "Amore per te", artist: "Mango" },
    expectedIds: ["Y-cVOswhJUU", "T2fi7Yk2Mn0"],
  },
];

// Variants we'd be tempted to add in Branch A. Logging all of them makes it
// easy to see whether the right video appears under any variant and at what
// rank — without having to ship the fan-out.
const QUERY_VARIANTS = (s: SongMeta): string[] => [
  `${s.artist} ${s.title}`,
  `${s.artist} ${s.title} live`,
  `${s.artist} ${s.title} lyrics`,
];

function parseIsoDuration(s: string | undefined): number {
  if (!s) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

async function search(query: string, key: string): Promise<Candidate[]> {
  const sUrl = `${SEARCH_URL}?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  const sRes = await fetch(sUrl);
  if (!sRes.ok) {
    console.error(`  search failed: ${sRes.status}`);
    return [];
  }
  const sJson = await sRes.json() as { items?: Array<{ id?: { videoId?: string } | string }> };
  const ids: string[] = [];
  for (const it of sJson.items ?? []) {
    const id = typeof it.id === "string" ? it.id : it.id?.videoId;
    if (id) ids.push(id);
  }
  if (ids.length === 0) return [];

  const vUrl = `${VIDEOS_URL}?part=snippet,status,contentDetails&id=${ids.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(key)}`;
  const vRes = await fetch(vUrl);
  if (!vRes.ok) {
    console.error(`  videos.list failed: ${vRes.status}`);
    return [];
  }
  const vJson = await vRes.json() as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; channelTitle?: string };
      status?: { privacyStatus?: string };
      contentDetails?: { duration?: string };
    }>;
  };
  const candidates: Candidate[] = [];
  // Preserve YouTube's relevance order
  for (const id of ids) {
    const item = vJson.items?.find((x) => x.id === id);
    if (!item) continue;
    if (item.status?.privacyStatus === "private") continue;
    candidates.push({
      id: item.id,
      title: item.snippet?.title ?? "",
      channel: item.snippet?.channelTitle ?? "",
      durationSec: parseIsoDuration(item.contentDetails?.duration),
    });
  }
  return candidates;
}

async function diagnose(c: Case, key: string) {
  console.log(`\n=== ${c.song.artist} / ${c.song.title} ===`);
  console.log(`expected ids: ${c.expectedIds.join(", ")}`);
  for (const query of c.queries ?? QUERY_VARIANTS(c.song)) {
    console.log(`\n--- query: "${query}" ---`);
    const candidates = await search(query, key);
    if (candidates.length === 0) {
      console.log("  (no candidates)");
      continue;
    }
    const rows = candidates.map((cand, idx) => {
      const sc = scoreCandidate(c.song, cand);
      const isExpected = c.expectedIds.includes(cand.id);
      return {
        rank: idx + 1,
        marker: isExpected ? "★" : " ",
        id: cand.id,
        score: sc.rejected ? "REJ" : sc.score,
        reason: sc.reason ?? "—",
        dur: cand.durationSec,
        title: cand.title.slice(0, 60),
        channel: cand.channel.slice(0, 30),
      };
    });
    console.table(rows);
    const picked = pickBestMatch(c.song, candidates);
    console.log(
      picked
        ? `  → matcher picks: ${picked.best} score=${picked.score} type=${picked.type} reason=${picked.reason}`
        : "  → matcher picks: NONE (below threshold)",
    );
    const expectedIn = candidates.find((x) => c.expectedIds.includes(x.id));
    if (expectedIn) {
      const sc = scoreCandidate(c.song, expectedIn);
      console.log(
        `  → expected ${expectedIn.id} present, score=${sc.rejected ? "REJ" : sc.score}, reason=${sc.reason ?? "—"}`,
      );
    } else {
      console.log("  → expected NOT present in results for this query");
    }
  }
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.error("YOUTUBE_API_KEY env var required");
    process.exit(1);
  }
  for (const c of CASES) {
    try {
      await diagnose(c, key);
    } catch (err) {
      console.error(`case failed: ${(err as Error).message}`);
    }
  }
}

void main();
