import { describe, expect, it } from "vitest";
import {
  EXACT_THRESHOLD,
  LOOSE_THRESHOLD,
  contentTokens,
  normalize,
  pickBestMatch,
  scoreCandidate,
  type Candidate,
  type SongMeta,
} from "@/lib/youtube-match";

const PAD = (s: string) => (s + "X".repeat(11)).slice(0, 11);

function cand(opts: {
  id?: string;
  title: string;
  channel: string;
  durationSec?: number;
}): Candidate {
  return {
    id: opts.id ?? PAD("a"),
    title: opts.title,
    channel: opts.channel,
    durationSec: opts.durationSec ?? 240,
  };
}

// === normalize / contentTokens =============================================

describe("normalize", () => {
  it("lowercases, strips diacritics + punctuation", () => {
    expect(normalize("Café au Lait! (Live)")).toBe("cafe au lait live");
  });

  it("collapses whitespace", () => {
    expect(normalize("  hello   world  ")).toBe("hello world");
  });
});

describe("contentTokens", () => {
  it("strips noise words like official/video/audio", () => {
    expect([...contentTokens("Hello (Official Music Video)")]).toEqual(["hello"]);
  });

  it("preserves the substantive tokens", () => {
    const t = contentTokens("Bohemian Rhapsody Live HD");
    expect(t.has("bohemian")).toBe(true);
    expect(t.has("rhapsody")).toBe(true);
    expect(t.has("live")).toBe(true);
    expect(t.has("hd")).toBe(false); // noise
  });
});

// === scoreCandidate (table-driven) =========================================

type Row = {
  desc: string;
  song: SongMeta;
  cand: Candidate;
  expect:
    | { rejected: true }
    | { rejected: false; type: "exact" | "loose" | "below"; reason?: string | null; min?: number; max?: number };
};

const cases: Row[] = [
  // ---- exact matches ----
  {
    desc: "canonical official video by VEVO",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({ title: "Adele - Hello (Official Music Video)", channel: "AdeleVEVO" }),
    expect: { rejected: false, type: "exact", min: EXACT_THRESHOLD },
  },
  {
    desc: "Topic auto-upload (artist - song)",
    song: { title: "Yesterday", artist: "The Beatles" },
    cand: cand({ title: "Yesterday", channel: "The Beatles - Topic" }),
    expect: { rejected: false, type: "exact", min: EXACT_THRESHOLD },
  },
  {
    desc: "official audio counts as exact-quality match",
    song: { title: "Shape of You", artist: "Ed Sheeran" },
    cand: cand({
      title: "Ed Sheeran - Shape of You (Official Audio)",
      channel: "Ed Sheeran",
    }),
    expect: { rejected: false, type: "exact", min: EXACT_THRESHOLD },
  },

  // ---- loose with reason ----
  {
    desc: "live performance",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Adele - Hello (Live at the Royal Albert Hall)",
      channel: "AdeleVEVO",
    }),
    expect: { rejected: false, type: "loose", reason: "live", min: LOOSE_THRESHOLD },
  },
  {
    desc: "lyric video",
    song: { title: "Shape of You", artist: "Ed Sheeran" },
    cand: cand({
      title: "Ed Sheeran - Shape of You (Lyric Video)",
      channel: "Ed Sheeran",
    }),
    expect: { rejected: false, type: "loose", reason: "lyric_video", min: LOOSE_THRESHOLD },
  },
  {
    desc: "acoustic version",
    song: { title: "Wonderwall", artist: "Oasis" },
    cand: cand({
      title: "Oasis - Wonderwall (Acoustic)",
      channel: "Oasis",
    }),
    expect: { rejected: false, type: "loose", reason: "acoustic", min: LOOSE_THRESHOLD },
  },
  {
    desc: "remastered version",
    song: { title: "Bohemian Rhapsody", artist: "Queen" },
    cand: cand({
      title: "Queen - Bohemian Rhapsody (Remastered 2011)",
      channel: "Queen Official",
    }),
    expect: { rejected: false, type: "loose", reason: "remaster", min: LOOSE_THRESHOLD },
  },
  {
    desc: "remix",
    song: { title: "Smooth Operator", artist: "Sade" },
    cand: cand({
      title: "Sade - Smooth Operator (Club Remix)",
      channel: "SomeRemixChannel",
    }),
    expect: { rejected: false, type: "loose", reason: "remix" },
  },
  {
    desc: "perfect title+artist from random channel is exact (artist confirms it's the song)",
    song: { title: "Hotel California", artist: "Eagles" },
    cand: cand({
      title: "Hotel California - Eagles",
      channel: "RandomMusicChannel",
    }),
    expect: { rejected: false, type: "exact" },
  },
  {
    desc: "partial title overlap + artist confirmation → loose with no specific reason",
    song: { title: "Bohemian Rhapsody", artist: "Queen" },
    cand: cand({
      title: "Bohemian — Queen mix",
      channel: "QueenChannel",
    }),
    expect: { rejected: false, type: "loose", reason: null },
  },

  // ---- hard rejects ----
  {
    desc: "karaoke version is a hard reject",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Adele - Hello (Karaoke Version)",
      channel: "SingKaraoke",
    }),
    expect: { rejected: true },
  },
  {
    desc: "instrumental is a hard reject",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Adele - Hello (Instrumental)",
      channel: "InstrumentalsHQ",
    }),
    expect: { rejected: true },
  },
  {
    desc: "reaction video is a hard reject",
    song: { title: "Bohemian Rhapsody", artist: "Queen" },
    cand: cand({
      title: "First Time Reaction to Queen - Bohemian Rhapsody",
      channel: "ReactGuy",
    }),
    expect: { rejected: true },
  },
  {
    desc: "tutorial is a hard reject",
    song: { title: "Hotel California", artist: "Eagles" },
    cand: cand({
      title: "How to play Hotel California guitar tutorial",
      channel: "GuitarLessons",
    }),
    expect: { rejected: true },
  },
  {
    desc: "nightcore is a hard reject",
    song: { title: "Closer", artist: "The Chainsmokers" },
    cand: cand({
      title: "Nightcore - Closer (The Chainsmokers)",
      channel: "NightcoreHits",
    }),
    expect: { rejected: true },
  },

  // ---- soft penalty: cover by someone else ----
  {
    desc: "cover by random user is capped below loose threshold",
    song: { title: "Yesterday", artist: "The Beatles" },
    cand: cand({
      title: "Yesterday - The Beatles (Cover by Some Random Guy)",
      channel: "RandomGuyMusic",
    }),
    expect: { rejected: false, type: "below", max: LOOSE_THRESHOLD - 1 },
  },
  {
    desc: "guitar cover penalty",
    song: { title: "Wonderwall", artist: "Oasis" },
    cand: cand({
      title: "Wonderwall - Oasis (Guitar Cover)",
      channel: "GuitarChannel",
    }),
    expect: { rejected: false, type: "below", max: LOOSE_THRESHOLD - 1 },
  },

  // ---- ambiguous "cover" not in cover-by pattern ----
  {
    desc: "song title literally contains 'Cover' (Cover Me Up)",
    song: { title: "Cover Me Up", artist: "Jamey Johnson" },
    cand: cand({
      title: "Jamey Johnson - Cover Me Up",
      channel: "Jamey Johnson",
    }),
    expect: { rejected: false, type: "exact" },
  },

  // ---- length sanity ----
  {
    desc: "very short clip is penalized",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Adele - Hello (Official Music Video)",
      channel: "AdeleVEVO",
      durationSec: 12,
    }),
    expect: { rejected: false, type: "loose" },
  },
  {
    desc: "very long compilation is penalized",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Adele - Hello (Official Music Video)",
      channel: "AdeleVEVO",
      durationSec: 30 * 60,
    }),
    expect: { rejected: false, type: "loose" },
  },

  // ---- artist-only-in-channel ----
  {
    desc: "artist only in channel still scores positively",
    song: { title: "Levitating", artist: "Dua Lipa" },
    cand: cand({
      title: "Levitating (Official Music Video)",
      channel: "Dua Lipa",
    }),
    expect: { rejected: false, type: "exact" },
  },

  // ---- low-quality misses ----
  {
    desc: "completely unrelated title",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Top 10 Cooking Tips for Beginners",
      channel: "CookingTV",
    }),
    expect: { rejected: false, type: "below", max: LOOSE_THRESHOLD - 1 },
  },
  {
    desc: "title overlap by accident, no artist match",
    song: { title: "Hello", artist: "Adele" },
    cand: cand({
      title: "Hello World — first programming video",
      channel: "DevTutorials",
    }),
    expect: { rejected: false, type: "below", max: LOOSE_THRESHOLD - 1 },
  },

  // ---- diacritics / non-ASCII ----
  {
    desc: "diacritics normalize correctly",
    song: { title: "Café Tacvba", artist: "Café Tacvba" },
    cand: cand({
      title: "Cafe Tacvba - Cafe Tacvba (Official Audio)",
      channel: "Cafe Tacvba",
    }),
    expect: { rejected: false, type: "exact" },
  },
];

describe("scoreCandidate (table-driven)", () => {
  for (const row of cases) {
    it(row.desc, () => {
      const r = scoreCandidate(row.song, row.cand);
      if ("rejected" in row.expect && row.expect.rejected) {
        expect(r.rejected).toBe(true);
        return;
      }
      expect(r.rejected).toBe(false);
      const exp = row.expect as Exclude<typeof row.expect, { rejected: true }>;
      if (exp.type === "exact") {
        expect(r.score).toBeGreaterThanOrEqual(EXACT_THRESHOLD);
      } else if (exp.type === "loose") {
        expect(r.score).toBeGreaterThanOrEqual(LOOSE_THRESHOLD);
        expect(r.score).toBeLessThan(EXACT_THRESHOLD);
      } else if (exp.type === "below") {
        expect(r.score).toBeLessThan(LOOSE_THRESHOLD);
      }
      if (exp.min !== undefined) expect(r.score).toBeGreaterThanOrEqual(exp.min);
      if (exp.max !== undefined) expect(r.score).toBeLessThanOrEqual(exp.max);
      if (exp.reason !== undefined) expect(r.reason).toBe(exp.reason);
    });
  }
});

// === pickBestMatch =========================================================

describe("pickBestMatch", () => {
  const song: SongMeta = { title: "Hello", artist: "Adele" };

  it("returns null when all candidates are rejected", () => {
    const result = pickBestMatch(song, [
      cand({ title: "Adele - Hello Karaoke" }),
      cand({ id: PAD("b"), title: "Hello Instrumental" }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when no candidate clears LOOSE threshold", () => {
    const result = pickBestMatch(song, [
      cand({ title: "Top 10 Cooking Tips", channel: "CookingTV" }),
      cand({ id: PAD("b"), title: "Some unrelated thing", channel: "Random" }),
    ]);
    expect(result).toBeNull();
  });

  it("prefers exact match over loose match even if loose comes first in input", () => {
    const looseFirst = cand({
      id: PAD("l"),
      title: "Adele - Hello (Live at the Royal Albert Hall)",
      channel: "AdeleVEVO",
    });
    const exact = cand({
      id: PAD("e"),
      title: "Adele - Hello (Official Music Video)",
      channel: "AdeleVEVO",
    });
    const result = pickBestMatch(song, [looseFirst, exact]);
    expect(result?.best).toBe(PAD("e"));
    expect(result?.type).toBe("exact");
    expect(result?.reason).toBe("exact");
    expect(result?.alternates).toEqual([PAD("l")]);
  });

  it("returns the loose match when no exact exists", () => {
    const live = cand({
      id: PAD("l"),
      title: "Adele - Hello (Live at the Royal Albert Hall)",
      channel: "AdeleVEVO",
    });
    const lyric = cand({
      id: PAD("y"),
      title: "Adele - Hello (Lyric Video)",
      channel: "SomeFanChannel",
    });
    const result = pickBestMatch(song, [live, lyric]);
    expect(result?.type).toBe("loose");
    expect(["live", "lyric_video"]).toContain(result?.reason);
  });

  it("captures match title + channel for the UI", () => {
    const result = pickBestMatch(song, [
      cand({
        title: "Adele - Hello (Official Music Video)",
        channel: "AdeleVEVO",
      }),
    ]);
    expect(result?.title).toBe("Adele - Hello (Official Music Video)");
    expect(result?.channel).toBe("AdeleVEVO");
    expect(result?.score).toBeGreaterThan(0);
  });

  it("alternates are next best non-rejected, capped at 3", () => {
    const candidates = ["a", "b", "c", "d", "e"].map((s) =>
      cand({
        id: PAD(s),
        title: `Adele - Hello ${s} (Official Music Video)`,
        channel: "AdeleVEVO",
      }),
    );
    const result = pickBestMatch(song, candidates);
    expect(result?.alternates).toHaveLength(3);
    expect(result?.alternates).not.toContain(result?.best);
  });
});
