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
  searchVideo,
  triggerMatchInBackground,
  YoutubeError,
} from "@/lib/youtube";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  _resetMatchChainForTests();
});

// --- fetch mock helpers -----------------------------------------------------

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

function searchResp(ids: string[]): MockedResponse {
  return {
    status: 200,
    json: {
      items: ids.map((id) => ({ id: { videoId: id } })),
    },
  };
}

// Mocks the /videos endpoint embeddability check. Each id is returned with
// status.embeddable=true and contentRating empty (i.e. not age-restricted)
// so the filter approves all of them.
function videosResp(ids: string[]): MockedResponse {
  return {
    status: 200,
    json: {
      items: ids.map((id) => ({
        id,
        status: { embeddable: true, privacyStatus: "public" },
        contentDetails: { contentRating: {} },
      })),
    },
  };
}

const PAD = (s: string) => (s + "X".repeat(11)).slice(0, 11);

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

// === searchVideo ===========================================================

describe("searchVideo", () => {
  it("returns best + up to 3 alternates", async () => {
    mockFetchSequence([searchResp([PAD("a"), PAD("b"), PAD("c"), PAD("d")])]);
    const m = await searchVideo("hello adele");
    expect(m.best).toBe(PAD("a"));
    expect(m.alternates).toEqual([PAD("b"), PAD("c"), PAD("d")]);
  });

  it("handles fewer than 4 results without padding", async () => {
    mockFetchSequence([searchResp([PAD("a"), PAD("b")])]);
    const m = await searchVideo("x");
    expect(m.best).toBe(PAD("a"));
    expect(m.alternates).toEqual([PAD("b")]);
  });

  it("throws YoutubeError(404) when 0 results", async () => {
    mockFetchSequence([{ status: 200, json: { items: [] } }]);
    await expect(searchVideo("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 404,
    });
  });

  it("filters items with malformed ids", async () => {
    mockFetchSequence([
      {
        status: 200,
        json: {
          items: [
            { id: { videoId: "shrt" } }, // wrong length
            { id: { videoId: PAD("z") } },
          ],
        },
      },
    ]);
    const m = await searchVideo("x");
    expect(m.best).toBe(PAD("z"));
  });

  it("maps 403 → YoutubeError(403)", async () => {
    mockFetchSequence([{ status: 403, json: { error: "quota" } }]);
    await expect(searchVideo("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 403,
    });
  });

  it("maps 429 with Retry-After → YoutubeError(429, retryAfterSeconds)", async () => {
    mockFetchSequence([
      { status: 429, json: {}, headers: { "retry-after": "8" } },
    ]);
    await expect(searchVideo("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 429,
      retryAfterSeconds: 8,
    });
  });

  it("throws YoutubeError(0) when YOUTUBE_API_KEY is missing", async () => {
    process.env.YOUTUBE_API_KEY = "";
    await expect(searchVideo("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 0,
    });
  });
});

// === matchSongById =========================================================

describe("matchSongById", () => {
  async function makeSong(opts: { youtubeId?: string | null } = {}) {
    return prisma.song.create({
      data: { title: "Hello", artist: "Adele", youtubeId: opts.youtubeId ?? null },
    });
  }

  it("populates youtubeId + youtubeAltIds on a fresh song", async () => {
    mockFetchSequence([searchResp([PAD("a"), PAD("b"), PAD("c"), PAD("d")])]);
    const s = await makeSong();
    await matchSongById(s.id);
    const updated = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(updated.youtubeId).toBe(PAD("a"));
    expect(updated.youtubeAltIds).toEqual([PAD("b"), PAD("c"), PAD("d")]);
  });

  it("skips when youtubeId is already set and force is falsy", async () => {
    const fetchSpy = mockFetchSequence([]);
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await matchSongById(s.id);
    expect(fetchSpy).not.toHaveBeenCalled();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe("EXISTINGYTID");
  });

  it("forces re-match when force:true overwrites existing youtubeId", async () => {
    mockFetchSequence([searchResp([PAD("n"), PAD("o")])]);
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await matchSongById(s.id, { force: true });
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe(PAD("n"));
    expect(after.youtubeAltIds).toEqual([PAD("o")]);
  });

  it("returns silently when the song doesn't exist", async () => {
    const fetchSpy = mockFetchSequence([]);
    await expect(
      matchSongById("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
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

// === triggerMatchInBackground (concurrency 1, error swallow) ==============

describe("triggerMatchInBackground", () => {
  async function makeSong(suffix = "") {
    return prisma.song.create({
      data: {
        title: `Song${suffix}`,
        artist: `Artist${suffix}`,
        youtubeId: null,
      },
    });
  }

  it("populates youtubeId via the chain (settled by flushPendingMatches)", async () => {
    mockFetchSequence([searchResp([PAD("z")])]);
    const s = await makeSong();
    triggerMatchInBackground(s.id);
    await flushPendingMatches();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBe(PAD("z"));
  });

  it("processes serially (concurrency 1), not in parallel", async () => {
    // Three searches in sequence; each search now also triggers a videos.list
    // embeddability check, so queue both per song.
    mockFetchSequence([
      searchResp([PAD("a")]), videosResp([PAD("a")]),
      searchResp([PAD("b")]), videosResp([PAD("b")]),
      searchResp([PAD("c")]), videosResp([PAD("c")]),
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
    // Sanity: each song got its result
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s1.id } })).youtubeId).toBe(PAD("a"));
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s2.id } })).youtubeId).toBe(PAD("b"));
    expect((await prisma.song.findUniqueOrThrow({ where: { id: s3.id } })).youtubeId).toBe(PAD("c"));
  });

  it("swallows errors instead of rejecting / unhandled promise rejection", async () => {
    // First search throws via 403; chain should not reject.
    mockFetchSequence([{ status: 403, json: {} }]);
    const s = await makeSong();
    triggerMatchInBackground(s.id);
    // If the chain rejected, this would throw:
    await expect(flushPendingMatches()).resolves.toBeUndefined();
    const after = await prisma.song.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.youtubeId).toBeNull();
  });

  it("a failure in one match does not poison the chain for the next", async () => {
    mockFetchSequence([
      { status: 403, json: {} }, // s1 fails
      searchResp([PAD("s")]),     // s2 succeeds
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
