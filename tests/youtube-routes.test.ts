import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test_youtube_key";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
});

import {
  clearCookies,
  jsonRequest,
  prisma,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";
import { _resetMatchChainForTests } from "@/lib/youtube";

import { POST as matchPOST } from "@/app/api/youtube/match/route";
import { POST as overridePOST } from "@/app/api/youtube/override/route";
import { POST as rematchMissingPOST } from "@/app/api/youtube/rematch-missing/route";

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
    json: { items: ids.map((id) => ({ id: { videoId: id } })) },
  };
}

function isoDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `PT${m > 0 ? `${m}M` : ""}${s > 0 ? `${s}S` : "0S"}`;
}

// Each id gets a canonical "Adele - Hello (Official Music Video)" title +
// AdeleVEVO channel so the scorer treats it as an exact match.
function videosResp(ids: string[]): MockedResponse {
  return {
    status: 200,
    json: {
      items: ids.map((id) => ({
        id,
        snippet: {
          title: `Adele - Hello (Official Music Video) [${id}]`,
          channelTitle: "AdeleVEVO",
        },
        status: { embeddable: true, privacyStatus: "public" },
        contentDetails: {
          duration: isoDuration(240),
          contentRating: {},
        },
      })),
    },
  };
}

function matchPair(ids: string[]): MockedResponse[] {
  return [searchResp(ids), videosResp(ids)];
}

const PAD = (s: string) => (s + "X".repeat(11)).slice(0, 11);

async function makeUser(name = "alice") {
  return prisma.user.create({ data: { name, role: "USER", accessCode: "x" } });
}

async function makeSong(opts: { youtubeId?: string | null } = {}) {
  return prisma.song.create({
    data: { title: "Hello", artist: "Adele", youtubeId: opts.youtubeId ?? null },
  });
}

// === POST /api/youtube/match (OWNER-only) ==================================

describe("POST /api/youtube/match", () => {
  it("401 without session", async () => {
    const s = await makeSong();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(401);
  });

  it("403 with USER session", async () => {
    const s = await makeSong();
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(403);
  });

  it("400 missing songId", async () => {
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", {}));
    expect(res.status).toBe(400);
  });

  it("404 unknown songId", async () => {
    await setOwnerSession();
    const res = await matchPOST(
      jsonRequest("http://x", { songId: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("happy path: writes youtubeId + altIds + match metadata, returns updated song", async () => {
    mockFetchSequence(matchPair([PAD("a"), PAD("b"), PAD("c"), PAD("d")]));
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("a"));
    expect(body.song.youtubeAltIds).toHaveLength(3);
    expect(body.song.youtubeMatchType).toBe("exact");
  });

  it("force-overwrites an existing youtubeId", async () => {
    mockFetchSequence(matchPair([PAD("n")]));
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("n"));
    expect(body.song.youtubeMatchType).toBe("exact");
  });

  it("404 with 'No YouTube match found' when search returns 0 items", async () => {
    mockFetchSequence([{ status: 200, json: { items: [] } }]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No YouTube match found");
  });

  it("502 when YouTube returns 5xx", async () => {
    mockFetchSequence([{ status: 500, json: { error: "ise" } }]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(502);
  });

  it("503 + Retry-After when YouTube 429s", async () => {
    mockFetchSequence([
      { status: 429, json: {}, headers: { "retry-after": "11" } },
    ]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("11");
  });

  it("502 when YOUTUBE_API_KEY is missing (config error)", async () => {
    process.env.YOUTUBE_API_KEY = "";
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(502);
  });
});

// === POST /api/youtube/override (OWNER-only) ===============================

describe("POST /api/youtube/override", () => {
  const VALID = "dQw4w9WgXcQ";

  it("401 without session", async () => {
    const s = await makeSong();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(401);
  });

  it("403 with USER session", async () => {
    const s = await makeSong();
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(403);
  });

  it("400 missing songId", async () => {
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { newYoutubeId: VALID }),
    );
    expect(res.status).toBe(400);
  });

  it("400 missing newYoutubeId", async () => {
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(400);
  });

  it("400 invalid newYoutubeId format (wrong length)", async () => {
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: "tooShort" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 invalid newYoutubeId format (disallowed chars)", async () => {
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: "dQw4w9WgXc!" }),
    );
    expect(res.status).toBe(400);
  });

  it("404 unknown song", async () => {
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: "00000000-0000-0000-0000-000000000000",
        newYoutubeId: VALID,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("happy path: updates youtubeId, leaves youtubeAltIds untouched", async () => {
    const s = await prisma.song.create({
      data: {
        title: "t",
        artist: "a",
        youtubeId: "OLDOLDOLDOL",
        youtubeAltIds: ["alt1alt1alt", "alt2alt2alt"],
      },
    });
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(VALID);
    expect(body.song.youtubeAltIds).toEqual(["alt1alt1alt", "alt2alt2alt"]);
  });
});

// === POST /api/youtube/rematch-missing (OWNER-only) ========================

describe("POST /api/youtube/rematch-missing", () => {
  // Title is plain "Hello" so it matches the canned videosResp title
  // ("Adele - Hello ..."). Songs are distinguished by id, not title.
  async function makeUnmatchedSong() {
    return prisma.song.create({
      data: { title: "Hello", artist: "Adele", youtubeId: null },
    });
  }

  it("401 without session", async () => {
    const res = await rematchMissingPOST();
    expect(res.status).toBe(401);
  });

  it("403 with USER session", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await rematchMissingPOST();
    expect(res.status).toBe(403);
  });

  it("happy path: matches all unmatched songs and reports counts", async () => {
    await makeUnmatchedSong();
    await makeUnmatchedSong();
    mockFetchSequence([
      ...matchPair([PAD("a")]),
      ...matchPair([PAD("b")]),
    ]);
    await setOwnerSession();
    const res = await rematchMissingPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBe(2);
    expect(body.matchedExact).toBe(2);
    expect(body.matchedLoose).toBe(0);
    expect(body.stillUnmatched).toBe(0);
  });

  it("counts loose matches separately from exact", async () => {
    await makeUnmatchedSong();
    mockFetchSequence([
      searchResp([PAD("l")]),
      {
        status: 200,
        json: {
          items: [
            {
              id: PAD("l"),
              snippet: {
                title: "Adele - Hello (Live at Royal Albert Hall)",
                channelTitle: "AdeleVEVO",
              },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT4M30S", contentRating: {} },
            },
          ],
        },
      },
    ]);
    await setOwnerSession();
    const res = await rematchMissingPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchedExact).toBe(0);
    expect(body.matchedLoose).toBe(1);
  });

  it("counts a 404-from-search song as stillUnmatched (not errored)", async () => {
    await makeUnmatchedSong();
    mockFetchSequence([{ status: 200, json: { items: [] } }]);
    await setOwnerSession();
    const res = await rematchMissingPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stillUnmatched).toBe(1);
    expect(body.errored).toBe(0);
  });

  it("bails with 503 on YouTube 403 (quota), preserving partial counts", async () => {
    await makeUnmatchedSong();
    await makeUnmatchedSong();
    mockFetchSequence([
      ...matchPair([PAD("a")]),
      { status: 403, json: {} },
    ]);
    await setOwnerSession();
    const res = await rematchMissingPOST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.matchedExact).toBe(1);
    expect(body.checked).toBe(2);
    expect(body.error).toMatch(/quota/i);
  });

  it("ignores already-matched songs (only youtubeId:null is processed)", async () => {
    await prisma.song.create({
      data: { title: "Hello", artist: "Adele", youtubeId: "ALREADYMATCH" },
    });
    const fetchSpy = mockFetchSequence([]);
    await setOwnerSession();
    const res = await rematchMissingPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
