import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCookies,
  emptyRequest,
  jsonRequest,
  prisma,
  setOwnerActingSession,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

// Stash + restore Spotify env so a missing-creds test can be exercised cleanly.
const ORIGINAL_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIGINAL_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

beforeEach(async () => {
  process.env.SPOTIFY_CLIENT_ID = "test_client_id";
  process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
  clearCookies();
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.SPOTIFY_CLIENT_ID = ORIGINAL_ID;
  process.env.SPOTIFY_CLIENT_SECRET = ORIGINAL_SECRET;
});

import { _resetTokenCacheForTests } from "@/lib/spotify";
import * as youtubeModule from "@/lib/youtube";
import { GET as searchGET } from "@/app/api/spotify/search/route";
import { POST as importPOST } from "@/app/api/spotify/import-playlist/route";

let triggerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetTokenCacheForTests();
  triggerSpy = vi
    .spyOn(youtubeModule, "triggerMatchInBackground")
    .mockImplementation(() => {});
});

// --- fetch mocking helpers (queue-of-canned-responses) --------------------

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

function tokenResponse(): MockedResponse {
  return { status: 200, json: { access_token: "tok", expires_in: 3600 } };
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

function track(id: string, name = `t-${id}`, opts: { artist?: string; album?: string } = {}) {
  return {
    track: {
      id,
      name,
      duration_ms: 1000,
      artists: [{ name: opts.artist ?? "Artist" }],
      album: { name: opts.album ?? "Album" },
    },
  };
}

async function makeUser(name: string = "alice") {
  return prisma.user.create({ data: { name, role: "USER", accessCode: "x" } });
}

// === GET /api/spotify/search ==============================================

describe("GET /api/spotify/search", () => {
  it("401 without session", async () => {
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=hello"));
    expect(res.status).toBe(401);
  });

  it("400 when q is missing", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search"));
    expect(res.status).toBe(400);
  });

  it("400 when q is whitespace", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=%20%20"));
    expect(res.status).toBe(400);
  });

  it("returns normalized results and DOES NOT persist", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          tracks: {
            items: [
              {
                id: "abc",
                name: "Hello",
                duration_ms: 1234,
                artists: [{ name: "Adele" }],
                album: {
                  name: "25",
                  images: [{ url: "https://img/cover.jpg" }],
                },
              },
            ],
          },
        },
      },
    ]);
    const songsBefore = await prisma.song.count();

    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=hello"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tracks).toEqual([
      {
        spotifyId: "abc",
        title: "Hello",
        artist: "Adele",
        album: "25",
        durationMs: 1234,
        albumImageUrl: "https://img/cover.jpg",
      },
    ]);

    // Critical: search does NOT persist.
    expect(await prisma.song.count()).toBe(songsBefore);
  });

  it("maps Spotify 4xx to 502", async () => {
    mockFetchSequence([tokenResponse(), { status: 500, json: { error: "oops" } }]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=x"));
    expect(res.status).toBe(502);
  });

  it("maps Spotify 429 to 503 with Retry-After", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 429, json: {}, headers: { "retry-after": "12" } },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=x"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("12");
  });

  it("maps missing creds to 502", async () => {
    process.env.SPOTIFY_CLIENT_ID = "";
    process.env.SPOTIFY_CLIENT_SECRET = "";
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await searchGET(emptyRequest("http://x/api/spotify/search?q=x"));
    expect(res.status).toBe(502);
  });
});

// === POST /api/spotify/import-playlist ===================================

describe("POST /api/spotify/import-playlist", () => {
  const PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M";
  const PLAYLIST_URL = `https://open.spotify.com/playlist/${PLAYLIST_ID}`;

  it("401 without session", async () => {
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for OWNER not impersonating", async () => {
    await setOwnerSession();
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(403);
  });

  it("400 for bad URL", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", {
        url: "https://example.com/playlist/abc",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 for missing url", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", {}),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: creates playlist + 3 songs in order", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "My Mix" } },
      {
        status: 200,
        json: {
          items: [track("a"), track("b"), track("c")],
          next: null,
        },
      },
    ]);

    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.playlist.name).toBe("My Mix");
    expect(body.songsImported).toBe(3);
    expect(body.songsReused).toBe(0);

    // DB shape
    expect(await prisma.playlist.count()).toBe(1);
    expect(await prisma.song.count()).toBe(3);

    const playlist = await prisma.playlist.findFirstOrThrow({
      include: { songs: { orderBy: { order: "asc" }, include: { song: true } } },
    });
    expect(playlist.userId).toBe(u.id);
    expect(playlist.songs.map((ps) => ps.song.spotifyId)).toEqual(["a", "b", "c"]);
    expect(playlist.songs.map((ps) => ps.order)).toEqual([0, 1, 2]);
    // youtubeId stays null on imported songs (Ticket 4 auto-matches in background)
    for (const ps of playlist.songs) {
      expect(ps.song.youtubeId).toBeNull();
    }
    // Auto-match trigger fired once per imported song (3 here)
    expect(triggerSpy).toHaveBeenCalledTimes(3);
  });

  it("dedup: reuses existing song by spotifyId", async () => {
    // Pre-existing local song with spotifyId "a", already has a youtubeId so
    // the auto-match trigger should NOT fire for it.
    await prisma.song.create({
      data: {
        title: "Local Title",
        artist: "Local Artist",
        spotifyId: "a",
        youtubeId: "EXISTINGYTID",
      },
    });

    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Mix" } },
      {
        status: 200,
        json: { items: [track("a"), track("b"), track("c")], next: null },
      },
    ]);

    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.songsImported).toBe(2);
    expect(body.songsReused).toBe(1);

    expect(await prisma.song.count()).toBe(3); // 1 pre-existing + 2 new
    const songA = await prisma.song.findUnique({ where: { spotifyId: "a" } });
    // Local fields preserved (not overwritten by import)
    expect(songA?.title).toBe("Local Title");
    expect(songA?.artist).toBe("Local Artist");

    // Auto-match trigger fired only for the 2 truly-new tracks (b, c) —
    // NOT for "a" because it already had a youtubeId.
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  it("re-importing the same playlist creates a second Playlist but reuses all songs", async () => {
    const tracks = [track("a"), track("b")];
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Mix" } },
      { status: 200, json: { items: tracks, next: null } },
      // Second import — fetch token still cached, so just playlist + tracks
      { status: 200, json: { name: "Mix" } },
      { status: 200, json: { items: tracks, next: null } },
    ]);

    const u = await makeUser();
    await setUserSession(u.id);

    const r1 = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(r1.status).toBe(201);
    expect((await r1.json()).songsReused).toBe(0);

    const r2 = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(r2.status).toBe(201);
    const body2 = await r2.json();
    expect(body2.songsImported).toBe(0);
    expect(body2.songsReused).toBe(2);

    expect(await prisma.playlist.count()).toBe(2);
    expect(await prisma.song.count()).toBe(2);
  });

  it("404 when Spotify says playlist not found", async () => {
    mockFetchSequence([tokenResponse(), { status: 404, json: { error: "no" } }]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(404);
  });

  it("empty playlist → 201 with empty Playlist row, songsImported = 0", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Empty" } },
      { status: 200, json: { items: [], next: null } },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.songsImported).toBe(0);
    expect(body.songsReused).toBe(0);
    expect(await prisma.playlist.count()).toBe(1);
    expect(await prisma.song.count()).toBe(0);
  });

  it("Spotify playlist with a duplicate track produces only one PlaylistSong row", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Dups" } },
      {
        status: 200,
        json: { items: [track("a"), track("a"), track("b")], next: null },
      },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.songsImported).toBe(2);
    expect(await prisma.playlistSong.count()).toBe(2);
    const playlist = await prisma.playlist.findFirstOrThrow({
      include: { songs: { orderBy: { order: "asc" } } },
    });
    expect(playlist.songs.map((ps) => ps.order)).toEqual([0, 1]);
  });

  it("caps auto-match triggers at 25 per import (quota guard)", async () => {
    // Build a 30-track playlist; only the first 25 unmatched songs should
    // get triggerMatchInBackground called.
    const tracks = Array.from({ length: 30 }, (_, i) => track(`t${i}`));
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Big Mix" } },
      { status: 200, json: { items: tracks, next: null } },
    ]);

    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.songsImported).toBe(30);
    expect(body.songsReused).toBe(0);
    expect(await prisma.song.count()).toBe(30);

    // Cap kicks in: exactly 25 trigger calls, not 30.
    expect(triggerSpy).toHaveBeenCalledTimes(25);
  });

  it("falls back to 'Imported Spotify Playlist' when Spotify returns no name", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "" } },
      { status: 200, json: { items: [track("a")], next: null } },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.playlist.name).toBe("Imported Spotify Playlist");
  });

  it("OWNER acting as user can import for that user", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Owned" } },
      { status: 200, json: { items: [track("a")], next: null } },
    ]);
    const u = await makeUser();
    await setOwnerActingSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(201);
    const playlist = await prisma.playlist.findFirstOrThrow();
    expect(playlist.userId).toBe(u.id);
  });
});
