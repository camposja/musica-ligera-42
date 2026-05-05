import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test_youtube_key";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
});

import { clearCookies, prisma, truncateAll } from "./helpers";
import {
  _resetMatchChainForTests,
  flushPendingMatches,
  isValidYoutubeId,
  matchSongById,
  searchCandidates,
  triggerMatchInBackground,
  YoutubeError,
} from "@/lib/youtube";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  _resetMatchChainForTests();
});

// --- fetch mock helpers ----------------------------------------------------

type MockedResponse = {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
};

function makeResponse(spec: MockedResponse): Response {
  const headers = new Headers(spec.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(spec.json ?? {}), {
    status: spec.status,
    headers,
  });
}

function mockFetchSequence(responses: MockedResponse[]) {
  let i = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (i >= responses.length) {
      throw new Error(
        `mockFetchSequence exhausted at call #${i + 1}; only ${responses.length} responses queued`,
      );
    }
    return makeResponse(responses[i++]);
  });
}

const PAD = (s: string) => (s + "X".repeat(11)).slice(0, 11);

type ItemSpec = {
  id: string;
  title?: string;
  channel?: string;
  durationSec?: number;
  embeddable?: boolean;
  ageRestricted?: boolean;
  isPrivate?: boolean;
};

function searchResp(specs: ItemSpec[]): MockedResponse {
  return {
    status: 200,
    json: { items: specs.map((s) => ({ id: { videoId: s.id } })) },
  };
}

function isoDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `PT${m > 0 ? `${m}M` : ""}${s > 0 ? `${s}S` : "0S"}`;
}

function videosResp(specs: ItemSpec[]): MockedResponse {
  return {
    status: 200,
    json: {
      items: specs.map((s) => ({
        id: s.id,
        snippet: {
          title: s.title ?? `Adele - Hello (Official Music Video) [${s.id}]`,
          channelTitle: s.channel ?? "AdeleVEVO",
        },
        status: {
          embeddable: s.embeddable ?? true,
          privacyStatus: s.isPrivate ? "private" : "public",
        },
        contentDetails: {
          duration: isoDuration(s.durationSec ?? 240),
          contentRating: s.ageRestricted ? { ytRating: "ytAgeRestricted" } : {},
        },
      })),
    },
  };
}

/** Pair of search + videos.list responses for a single match call. */
function matchPair(specs: ItemSpec[]): MockedResponse[] {
  return [searchResp(specs), videosResp(specs)];
}

// === isValidYoutubeId ======================================================

describe("isValidYoutubeId", () => {
  it("accepts an 11-char alphanum/_/- id", () => {
    expect(isValidYoutubeId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidYoutubeId("a-_0123ABCD")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidYoutubeId("short")).toBe(false);
    expect(isValidYoutubeId("dQw4w9WgXcQQQQQ")).toBe(false);
  });

  it("rejects disallowed characters", () => {
    expect(isValidYoutubeId("dQw4w9WgXc!")).toBe(false);
    expect(isValidYoutubeId("dQw4w9 gXcQ")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidYoutubeId(null as unknown as string)).toBe(false);
    expect(isValidYoutubeId(undefined as unknown as string)).toBe(false);
  });
});

// === searchCandidates ======================================================

describe("searchCandidates", () => {
  it("returns rich candidates from search + videos.list", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("a"), title: "Adele - Hello (Official Music Video)", channel: "AdeleVEVO" },
        { id: PAD("b"), title: "Adele - Hello (Live)", channel: "AdeleVEVO" },
      ]),
    );
    const out = await searchCandidates("hello adele");
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(PAD("a"));
    expect(out[0].title).toContain("Hello");
    expect(out[0].channel).toBe("AdeleVEVO");
    expect(out[0].durationSec).toBe(240);
  });

  it("returns empty array when search has 0 items", async () => {
    mockFetchSequence([{ status: 200, json: { items: [] } }]);
    const out = await searchCandidates("x");
    expect(out).toEqual([]);
  });

  it("filters out private videos (yt-dlp can't play them either)", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("a"), isPrivate: true },
        { id: PAD("b") },
      ]),
    );
    const out = await searchCandidates("x");
    expect(out.map((c) => c.id)).toEqual([PAD("b")]);
  });

  it("KEEPS non-embeddable + age-restricted (yt-dlp plays them; iframe is just fallback)", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("a"), embeddable: false },
        { id: PAD("b"), ageRestricted: true },
      ]),
    );
    const out = await searchCandidates("x");
    expect(out.map((c) => c.id).sort()).toEqual([PAD("a"), PAD("b")].sort());
  });

  it("filters items with malformed ids", async () => {
    mockFetchSequence([
      {
        status: 200,
        json: {
          items: [
            { id: { videoId: "shrt" } },
            { id: { videoId: PAD("z") } },
          ],
        },
      },
      videosResp([{ id: PAD("z") }]),
    ]);
    const out = await searchCandidates("x");
    expect(out.map((c) => c.id)).toEqual([PAD("z")]);
  });

  it("maps 403 → YoutubeError(403)", async () => {
    mockFetchSequence([{ status: 403, json: { error: "quota" } }]);
    await expect(searchCandidates("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 403,
    });
  });

  it("maps 429 with Retry-After → YoutubeError(429, retryAfterSeconds)", async () => {
    mockFetchSequence([
      { status: 429, json: {}, headers: { "retry-after": "8" } },
    ]);
    await expect(searchCandidates("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 429,
      retryAfterSeconds: 8,
    });
  });

  it("throws YoutubeError(0) when YOUTUBE_API_KEY is missing", async () => {
    process.env.YOUTUBE_API_KEY = "";
    await expect(searchCandidates("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 0,
    });
  });
});

// === matchSongById =========================================================

describe("matchSongById", () => {
  async function makeSong(opts: { youtubeId?: string | null; title?: string; artist?: string } = {}) {
    return prisma.song.create({
      data: {
        title: opts.title ?? "Hello",
        artist: opts.artist ?? "Adele",
        youtubeId: opts.youtubeId ?? null,
      },
    });
  }

  it("populates youtubeId + altIds + match metadata on a fresh exact match", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("a"), title: "Adele - Hello (Official Music Video)", channel: "AdeleVEVO" },
        { id: PAD("b"), title: "Adele - Hello", channel: "AdeleVEVO" },
        { id: PAD("c"), title: "Adele - Hello", channel: "AdeleVEVO" },
        { id: PAD("d"), title: "Adele - Hello", channel: "AdeleVEVO" },
      ]),
    );
    const s = await makeSong();
    const out = await matchSongById(s.id);
    expect(out.matched).toBe(true);
    const updated = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(updated.youtubeId).toBe(PAD("a"));
    expect(updated.youtubeMatchType).toBe("exact");
    expect(updated.youtubeMatchReason).toBe("exact");
    expect(updated.youtubeMatchTitle).toContain("Hello");
    expect(updated.youtubeMatchChannel).toBe("AdeleVEVO");
  });

  it("records loose match metadata when only loose candidates exist", async () => {
    mockFetchSequence(
      matchPair([
        {
          id: PAD("l"),
          title: "Adele - Hello (Live at the Royal Albert Hall)",
          channel: "AdeleVEVO",
        },
        {
          id: PAD("y"),
          title: "Adele - Hello (Lyric Video)",
          channel: "SomeFanChannel",
        },
      ]),
    );
    const s = await makeSong();
    const out = await matchSongById(s.id);
    expect(out.matched).toBe(true);
    const updated = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(updated.youtubeMatchType).toBe("loose");
    expect(["live", "lyric_video"]).toContain(updated.youtubeMatchReason);
  });

  it("throws YoutubeError(404) when no candidate clears the loose threshold", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("a"), title: "Top 10 Cooking Tips", channel: "CookingTV" },
      ]),
    );
    const s = await makeSong();
    await expect(matchSongById(s.id)).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 404,
    });
  });

  it("skips when youtubeId is already set and force is falsy", async () => {
    const fetchSpy = mockFetchSequence([]);
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    const out = await matchSongById(s.id);
    expect(out.matched).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe("EXISTINGYTID");
  });

  it("force re-matches and updates metadata", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("n"), title: "Adele - Hello (Official Music Video)", channel: "AdeleVEVO" },
      ]),
    );
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await matchSongById(s.id, { force: true });
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe(PAD("n"));
    expect(after.youtubeMatchType).toBe("exact");
  });

  it("returns matched:false when the song doesn't exist", async () => {
    const fetchSpy = mockFetchSequence([]);
    const out = await matchSongById("00000000-0000-0000-0000-000000000000");
    expect(out.matched).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates YoutubeError to caller (no swallow at this layer)", async () => {
    mockFetchSequence([{ status: 403, json: {} }]);
    const s = await makeSong();
    await expect(matchSongById(s.id)).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 403,
    });
  });
});

// === triggerMatchInBackground ==============================================

describe("triggerMatchInBackground", () => {
  async function makeSong(suffix = "") {
    return prisma.song.create({
      data: {
        title: `Hello${suffix}`,
        artist: "Adele",
        youtubeId: null,
      },
    });
  }

  it("populates youtubeId via the chain (settled by flushPendingMatches)", async () => {
    mockFetchSequence(
      matchPair([
        { id: PAD("z"), title: "Adele - Hello (Official Music Video)", channel: "AdeleVEVO" },
      ]),
    );
    const s = await makeSong();
    triggerMatchInBackground(s.id);
    await flushPendingMatches();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe(PAD("z"));
  });

  it("processes serially (concurrency 1), each match makes 2 fetches", async () => {
    mockFetchSequence([
      ...matchPair([{ id: PAD("a"), title: "Adele - Hello", channel: "AdeleVEVO" }]),
      ...matchPair([{ id: PAD("b"), title: "Adele - Hello", channel: "AdeleVEVO" }]),
      ...matchPair([{ id: PAD("c"), title: "Adele - Hello", channel: "AdeleVEVO" }]),
    ]);
    const s1 = await makeSong("1");
    const s2 = await makeSong("2");
    const s3 = await makeSong("3");
    triggerMatchInBackground(s1.id);
    triggerMatchInBackground(s2.id);
    triggerMatchInBackground(s3.id);
    await flushPendingMatches();
    const searchCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((c) => String(c[0]).includes("/youtube/v3/search"));
    expect(searchCalls).toHaveLength(3);
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s1.id } })).youtubeId).toBe(PAD("a"));
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s2.id } })).youtubeId).toBe(PAD("b"));
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s3.id } })).youtubeId).toBe(PAD("c"));
  });

  it("swallows errors instead of rejecting", async () => {
    mockFetchSequence([{ status: 403, json: {} }]);
    const s = await makeSong();
    triggerMatchInBackground(s.id);
    await expect(flushPendingMatches()).resolves.toBeUndefined();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBeNull();
  });

  it("a failure in one match does not poison the chain for the next", async () => {
    mockFetchSequence([
      { status: 403, json: {} },
      ...matchPair([{ id: PAD("s"), title: "Adele - Hello", channel: "AdeleVEVO" }]),
    ]);
    const s1 = await makeSong("1");
    const s2 = await makeSong("2");
    triggerMatchInBackground(s1.id);
    triggerMatchInBackground(s2.id);
    await flushPendingMatches();
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s1.id } })).youtubeId).toBeNull();
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s2.id } })).youtubeId).toBe(PAD("s"));
  });
});

// === YoutubeError class ====================================================

describe("YoutubeError", () => {
  it("constructs with status, message, optional retry-after", () => {
    const e = new YoutubeError(429, "rate limit", 9);
    expect(e.name).toBe("YoutubeError");
    expect(e.httpStatus).toBe(429);
    expect(e.retryAfterSeconds).toBe(9);
    expect(e instanceof Error).toBe(true);
  });
});
