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

  it("happy path: writes youtubeId + youtubeAltIds, returns updated song", async () => {
    mockFetchSequence([searchResp([PAD("a"), PAD("b"), PAD("c"), PAD("d")])]);
    const s = await makeSong();
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("a"));
    expect(body.song.youtubeAltIds).toEqual([PAD("b"), PAD("c"), PAD("d")]);
  });

  it("force-overwrites an existing youtubeId", async () => {
    mockFetchSequence([searchResp([PAD("n")])]);
    const s = await makeSong({ youtubeId: "EXISTINGYTID" });
    await setOwnerSession();
    const res = await matchPOST(jsonRequest("http://x", { songId: s.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.song.youtubeId).toBe(PAD("n"));
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
