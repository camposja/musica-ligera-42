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
import { GET as youtubeSearchGET } from "@/app/api/youtube/search/route";

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

// === POST /api/youtube/match ===============================================
// Any signed-in user can request a match; only OWNER can force-overwrite.

describe("POST /api/youtube/match", () => {
  it("401 without session", async () => {
    const s = await makeSong();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(401);
  });

  it("USER without force: 200 (matches the song)", async () => {
    mockFetchSequence(matchPair([PAD("a")]));
    const s = await makeSong();
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("a"));
  });

  it("USER with force=true: 403 (force is OWNER-only)", async () => {
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    const u = await makeUser();
    await setUserSession(u.id);
    const fetchSpy = mockFetchSequence([]);
    const res = await matchPOST(
      jsonRequest("http://x", { songId: s.id, force: true }),
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("OWNER + force=true: overwrites an existing youtubeId", async () => {
    mockFetchSequence(matchPair([PAD("n")]));
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await setOwnerSession();
    const res = await matchPOST(
      jsonRequest("http://x", { songId: s.id, force: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("n"));
    expect(body.song.youtubeMatchType).toBe("exact");
  });

  it("short-circuits when youtubeId already set (no force, no fetch)", async () => {
    const s = await makeSong({ youtubeId: "ALREADYMATCH" });
    const u = await makeUser();
    await setUserSession(u.id);
    const fetchSpy = mockFetchSequence([]);
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe("ALREADYMATCH");
    expect(fetchSpy).not.toHaveBeenCalled();
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

  // The override route now validates the pasted id via /videos. Build a
  // single-item videos.list response with a configurable title/channel so
  // tests can assert metadata is propagated to the song row.
  function videoDetails(opts: {
    id?: string;
    title?: string;
    channel?: string;
    isPrivate?: boolean;
    notFound?: boolean;
  } = {}): MockedResponse {
    if (opts.notFound) {
      return { status: 200, json: { items: [] } };
    }
    return {
      status: 200,
      json: {
        items: [
          {
            id: opts.id ?? VALID,
            snippet: {
              title: opts.title ?? "Some Video Title",
              channelTitle: opts.channel ?? "Some Channel",
            },
            status: {
              embeddable: true,
              privacyStatus: opts.isPrivate ? "private" : "public",
            },
            contentDetails: { duration: "PT3M30S", contentRating: {} },
          },
        ],
      },
    };
  }

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

  it("400 when neither youtubeUrl nor newYoutubeId provided", async () => {
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

  it("400 unparseable youtubeUrl", async () => {
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: s.id,
        youtubeUrl: "https://vimeo.com/123456",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 youtube shorts URL is rejected", async () => {
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: s.id,
        youtubeUrl: `https://youtube.com/shorts/${VALID}`,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404 unknown song (validates input before DB lookup not relied on)", async () => {
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: "00000000-0000-0000-0000-000000000000",
        newYoutubeId: VALID,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400 when YouTube reports the video does not exist", async () => {
    mockFetchSequence([videoDetails({ notFound: true })]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when YouTube reports the video is private", async () => {
    mockFetchSequence([videoDetails({ isPrivate: true })]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(400);
  });

  it("happy path with raw id: writes id, clears altIds, sets manual reason + title/channel", async () => {
    mockFetchSequence([
      videoDetails({
        title: "Mango - Amore Per Te (Official Audio)",
        channel: "Mango Official",
      }),
    ]);
    const s = await prisma.song.create({
      data: {
        title: "Amore per te",
        artist: "Mango",
        youtubeId: "OLDOLDOLDOL",
        youtubeAltIdsJson: JSON.stringify(["alt1alt1alt", "alt2alt2alt"]),
      },
    });
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", { songId: s.id, newYoutubeId: VALID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(VALID);
    expect(body.song.youtubeAltIds).toEqual([]);
    expect(body.song.youtubeMatchType).toBe("loose");
    expect(body.song.youtubeMatchReason).toBe("manual");
    expect(body.song.youtubeMatchTitle).toBe(
      "Mango - Amore Per Te (Official Audio)",
    );
    expect(body.song.youtubeMatchChannel).toBe("Mango Official");
  });

  it("happy path with full youtube.com URL", async () => {
    mockFetchSequence([videoDetails()]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: s.id,
        youtubeUrl: `https://www.youtube.com/watch?v=${VALID}&list=PL1`,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(VALID);
    expect(body.song.youtubeMatchReason).toBe("manual");
  });

  it("happy path with youtu.be short URL", async () => {
    mockFetchSequence([videoDetails()]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await overridePOST(
      jsonRequest("http://x", {
        songId: s.id,
        youtubeUrl: `https://youtu.be/${VALID}`,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(VALID);
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

// === GET /api/youtube/search ==============================================

describe("GET /api/youtube/search", () => {
  const ORIGINAL_SAFETY = process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS;

  beforeEach(() => {
    // Default to a generous cap so most tests don't trip the safeguard.
    process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = "10000";
  });

  afterEach(() => {
    process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = ORIGINAL_SAFETY;
  });

  function searchRequest(q: string | null): Request {
    const url = q === null ? "http://x/api/youtube/search" : `http://x/api/youtube/search?q=${encodeURIComponent(q)}`;
    return new Request(url);
  }

  it("401 without session", async () => {
    const res = await youtubeSearchGET(searchRequest("hello"));
    expect(res.status).toBe(401);
  });

  it("400 when q missing", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest(null));
    expect(res.status).toBe(400);
  });

  it("400 when q is empty/whitespace", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("   "));
    expect(res.status).toBe(400);
  });

  it("happy path: returns rich results + quota status", async () => {
    mockFetchSequence([
      searchResp([PAD("a"), PAD("b")]),
      {
        status: 200,
        json: {
          items: [
            {
              id: PAD("a"),
              snippet: {
                title: "Adele - Hello",
                channelTitle: "AdeleVEVO",
                thumbnails: { medium: { url: "https://i.ytimg.com/vi/a/m.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT3M30S", contentRating: {} },
            },
            {
              id: PAD("b"),
              snippet: { title: "Other", channelTitle: "Channel" },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT2M", contentRating: {} },
            },
          ],
        },
      },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("hello adele"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toMatchObject({
      youtubeId: PAD("a"),
      title: "Adele - Hello",
      channel: "AdeleVEVO",
      durationSec: 210,
      url: `https://www.youtube.com/watch?v=${PAD("a")}`,
      thumbnailUrl: "https://i.ytimg.com/vi/a/m.jpg",
    });
    expect(body.quota).toMatchObject({
      remainingSearches: expect.any(Number),
      remainingUnits: expect.any(Number),
      resetsAt: expect.any(String),
    });
    // Charged once (103 units).
    expect(body.quota.remainingUnits).toBe(10000 - 103);
  });

  it("filters out private videos", async () => {
    mockFetchSequence([
      searchResp([PAD("a"), PAD("b")]),
      {
        status: 200,
        json: {
          items: [
            {
              id: PAD("a"),
              snippet: { title: "x", channelTitle: "y" },
              status: { embeddable: true, privacyStatus: "private" },
              contentDetails: { duration: "PT3M", contentRating: {} },
            },
            {
              id: PAD("b"),
              snippet: { title: "z", channelTitle: "y" },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT3M", contentRating: {} },
            },
          ],
        },
      },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { youtubeId: string }) => r.youtubeId)).toEqual([
      PAD("b"),
    ]);
  });

  it("429 with code: youtube_quota_safeguard when ledger says no", async () => {
    process.env.YOUTUBE_DAILY_QUOTA_SAFETY_UNITS = "50"; // less than one search
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("hello"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("youtube_quota_safeguard");
    expect(body.remainingSearches).toBe(0);
    expect(body.resetsAt).toMatch(/T00:00:00\.000Z$/);
  });

  it("429 + safeguard when YouTube returns 403 (defensive lockout)", async () => {
    mockFetchSequence([{ status: 403, json: {} }]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("hello"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("youtube_quota_safeguard");
    // After upstream 403 + markQuotaExhausted, remaining is 0.
    expect(body.remainingSearches).toBe(0);
  });

  it("503 when YouTube returns 5xx", async () => {
    mockFetchSequence([{ status: 502, json: {} }]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await youtubeSearchGET(searchRequest("x"));
    expect(res.status).toBe(502);
  });
});
