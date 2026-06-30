import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCookies, prisma, setUserSession, truncateAll } from "./helpers";
import {
  looselyMatches,
  lyricsKey,
  lyricsMatchNorm,
} from "@/lib/lyrics/normalize";
import {
  bestMatch,
  fetchLyrics,
  getURL,
  LrclibError,
  searchURL,
  toLookup,
} from "@/lib/lyrics/lrclib";
import { lookup, prune, record } from "@/lib/lyrics/cache";
import { getLyrics } from "@/lib/lyrics/service";
import { GET as lyricsGET } from "@/app/api/lyrics/route";

// --- fetch mock -------------------------------------------------------------

type Mocked = { status: number; json?: unknown };

function makeResponse(spec: Mocked): Response {
  return new Response(JSON.stringify(spec.json ?? {}), {
    status: spec.status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchSequence(responses: Mocked[]) {
  let i = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (i >= responses.length) throw new Error(`lyrics fetch exhausted at #${i + 1}`);
    return makeResponse(responses[i++]);
  });
}

const track = (over: Record<string, unknown> = {}) => ({
  trackName: "Hello",
  artistName: "Adele",
  plainLyrics: "Hello, it's me",
  instrumental: false,
  ...over,
});

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

// --- normalize --------------------------------------------------------------

describe("lyrics normalize", () => {
  it("lyricsKey folds diacritics, lowercases, collapses, keeps punctuation", () => {
    expect(lyricsKey("Beyoncé", "Déjà Vu")).toBe("beyonce|deja vu");
    expect(lyricsKey("  Adele ", "Hello   (Live)")).toBe("adele|hello (live)");
  });

  it("lyricsKey keeps punctuation variants distinct", () => {
    expect(lyricsKey("A", "Track")).not.toBe(lyricsKey("A", "Track (Live)"));
  });

  it("lyricsMatchNorm strips punctuation and folds diacritics", () => {
    expect(lyricsMatchNorm("Déjà-Vu!")).toBe("deja vu");
  });

  it("looselyMatches: equal or substring either way; empty fails", () => {
    expect(looselyMatches("hello", "hello")).toBe(true);
    expect(looselyMatches("hello world", "hello")).toBe(true);
    expect(looselyMatches("hello", "hello world")).toBe(true);
    expect(looselyMatches("hello", "")).toBe(false);
    expect(looselyMatches("hello", "bye")).toBe(false);
  });
});

// --- lrclib provider --------------------------------------------------------

describe("lrclib provider", () => {
  it("getURL adds album only when present; searchURL is 'title artist'", () => {
    expect(getURL("Hello", "Adele", null)).toBe(
      "https://lrclib.net/api/get?artist_name=Adele&track_name=Hello",
    );
    expect(getURL("Hello", "Adele", "25")).toContain("album_name=25");
    expect(searchURL("Hello", "Adele")).toBe(
      "https://lrclib.net/api/search?q=Hello+Adele",
    );
  });

  it("toLookup: plainLyrics -> found; instrumental -> instrumental; else not_found", () => {
    expect(toLookup(track())).toEqual({ kind: "found", lyrics: "Hello, it's me" });
    expect(toLookup(track({ plainLyrics: "   ", instrumental: true }))).toEqual({
      kind: "instrumental",
    });
    expect(toLookup(track({ plainLyrics: null, instrumental: false }))).toEqual({
      kind: "not_found",
    });
  });

  it("bestMatch accepts loose artist+title match, rejects mismatch", () => {
    const ok = [track({ trackName: "Hello (Live)", artistName: "Adele" })];
    expect(bestMatch(ok, "Hello", "Adele")).toBe(ok[0]);
    expect(
      bestMatch([track({ trackName: "Wrong", artistName: "Nope" })], "Hello", "Adele"),
    ).toBeNull();
  });

  it("fetchLyrics: /get hit returns found without a search call", async () => {
    const spy = mockFetchSequence([{ status: 200, json: track() }]);
    expect(await fetchLyrics("Hello", "Adele", null)).toEqual({
      kind: "found",
      lyrics: "Hello, it's me",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fetchLyrics: /get 404 falls back to /search and matches", async () => {
    mockFetchSequence([
      { status: 404, json: {} },
      { status: 200, json: [track({ trackName: "Hello", artistName: "Adele" })] },
    ]);
    expect(await fetchLyrics("Hello", "Adele", null)).toEqual({
      kind: "found",
      lyrics: "Hello, it's me",
    });
  });

  it("fetchLyrics: /get 404 + no acceptable search match -> not_found", async () => {
    mockFetchSequence([
      { status: 404, json: {} },
      { status: 200, json: [track({ trackName: "Zzz", artistName: "Nobody" })] },
    ]);
    expect(await fetchLyrics("Hello", "Adele", null)).toEqual({ kind: "not_found" });
  });

  it("fetchLyrics: non-404 upstream error throws LrclibError", async () => {
    mockFetchSequence([{ status: 500, json: {} }]);
    await expect(fetchLyrics("Hello", "Adele", null)).rejects.toBeInstanceOf(LrclibError);
  });

  it("sends a descriptive User-Agent header", async () => {
    const spy = mockFetchSequence([{ status: 200, json: track() }]);
    await fetchLyrics("Hello", "Adele", null);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain(
      "musica-ligera-web",
    );
  });
});

// --- cache ------------------------------------------------------------------

describe("lyrics cache", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("records and reads back a found hit", async () => {
    await record("a|b", { kind: "found", lyrics: "la la" });
    expect(await lookup("a|b")).toEqual({ kind: "found", lyrics: "la la" });
  });

  it("persists instrumental distinctly from not_found", async () => {
    await record("i|i", { kind: "instrumental" });
    await record("n|n", { kind: "not_found" });
    expect(await lookup("i|i")).toEqual({ kind: "instrumental" });
    expect(await lookup("n|n")).toEqual({ kind: "not_found" });
  });

  it("miss returns null", async () => {
    expect(await lookup("nope|nope")).toBeNull();
  });

  it("expires not_found after 2d but keeps instrumental/found at 3d", async () => {
    const old = new Date(Date.now() - 3 * DAY);
    await prisma.lyricsCache.create({
      data: { cacheKey: "nf|x", status: "not_found", lyrics: "", createdAt: old },
    });
    await prisma.lyricsCache.create({
      data: { cacheKey: "in|x", status: "instrumental", lyrics: "", createdAt: old },
    });
    await prisma.lyricsCache.create({
      data: { cacheKey: "fo|x", status: "found", lyrics: "hi", createdAt: old },
    });
    expect(await lookup("nf|x")).toBeNull();
    expect(await lookup("in|x")).toEqual({ kind: "instrumental" });
    expect(await lookup("fo|x")).toEqual({ kind: "found", lyrics: "hi" });
  });

  it("expires found/instrumental after 30d", async () => {
    const old = new Date(Date.now() - 31 * DAY);
    await prisma.lyricsCache.create({
      data: { cacheKey: "f|old", status: "found", lyrics: "x", createdAt: old },
    });
    expect(await lookup("f|old")).toBeNull();
  });

  it("prune deletes only past-TTL rows", async () => {
    await prisma.lyricsCache.create({
      data: { cacheKey: "nf|old", status: "not_found", lyrics: "", createdAt: new Date(Date.now() - 3 * DAY) },
    });
    await prisma.lyricsCache.create({
      data: { cacheKey: "nf|new", status: "not_found", lyrics: "", createdAt: new Date() },
    });
    expect(await prune()).toBe(1);
    expect(await prisma.lyricsCache.findUnique({ where: { cacheKey: "nf|old" } })).toBeNull();
    expect(await prisma.lyricsCache.findUnique({ where: { cacheKey: "nf|new" } })).not.toBeNull();
  });

  it("re-record resets the TTL clock", async () => {
    await prisma.lyricsCache.create({
      data: { cacheKey: "r|k", status: "found", lyrics: "old", createdAt: new Date(Date.now() - 31 * DAY) },
    });
    await record("r|k", { kind: "found", lyrics: "new" });
    expect(await lookup("r|k")).toEqual({ kind: "found", lyrics: "new" });
  });
});

// --- service (cache-first) --------------------------------------------------

describe("getLyrics service", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("caches a found result; 2nd call is a cache hit (no network)", async () => {
    const spy = mockFetchSequence([{ status: 200, json: track() }]);
    const first = await getLyrics({ title: "Hello", artist: "Adele", album: null });
    const second = await getLyrics({ title: "Hello", artist: "Adele", album: null });
    expect(first).toEqual({ state: "found", lyrics: "Hello, it's me" });
    expect(second).toEqual({ state: "found", lyrics: "Hello, it's me" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps a provider transport failure to the error state", async () => {
    mockFetchSequence([{ status: 500, json: {} }]);
    expect(await getLyrics({ title: "Hello", artist: "Adele", album: null })).toEqual({
      state: "error",
      error: "Couldn't load lyrics.",
    });
  });
});

// --- route ------------------------------------------------------------------

describe("GET /api/lyrics", () => {
  beforeEach(async () => {
    clearCookies();
    await truncateAll();
  });

  async function asUser() {
    const u = await prisma.user.create({ data: { name: "alice", role: "USER", accessCode: "x" } });
    await setUserSession(u.id);
  }

  it("401 without session", async () => {
    const res = await lyricsGET(new Request("http://x/api/lyrics?songId=abc"));
    expect(res.status).toBe(401);
  });

  it("400 missing songId", async () => {
    await asUser();
    const res = await lyricsGET(new Request("http://x/api/lyrics"));
    expect(res.status).toBe(400);
  });

  it("404 unknown song", async () => {
    await asUser();
    const res = await lyricsGET(
      new Request("http://x/api/lyrics?songId=00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(404);
  });

  it("returns found with lyrics for a USER session", async () => {
    mockFetchSequence([{ status: 200, json: track() }]);
    await asUser();
    const song = await prisma.song.create({ data: { title: "Hello", artist: "Adele" } });
    const res = await lyricsGET(new Request(`http://x/api/lyrics?songId=${song.id}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "found", lyrics: "Hello, it's me" });
  });

  it("returns not_found when LRCLIB has nothing", async () => {
    mockFetchSequence([{ status: 404, json: {} }, { status: 200, json: [] }]);
    await asUser();
    const song = await prisma.song.create({ data: { title: "Obscure", artist: "Nobody" } });
    const res = await lyricsGET(new Request(`http://x/api/lyrics?songId=${song.id}`));
    expect(await res.json()).toEqual({ state: "not_found" });
  });
});
