import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCookies,
  emptyRequest,
  jsonRequest,
  prisma,
  seedSpotifyConnection,
  setOwnerActingSession,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

// Stash + restore Spotify env so a missing-creds test can be exercised cleanly.
const ORIGINAL_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIGINAL_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const ORIGINAL_REDIRECT = process.env.SPOTIFY_REDIRECT_URI;

beforeEach(async () => {
  process.env.SPOTIFY_CLIENT_ID = "test_client_id";
  process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
  process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/api/spotify/callback";
  clearCookies();
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.SPOTIFY_CLIENT_ID = ORIGINAL_ID;
  process.env.SPOTIFY_CLIENT_SECRET = ORIGINAL_SECRET;
  process.env.SPOTIFY_REDIRECT_URI = ORIGINAL_REDIRECT;
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
  text?: string;
  headers?: Record<string, string>;
};

function makeResponse(spec: MockedResponse): Response {
  const headers = new Headers(spec.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const body = spec.text !== undefined ? spec.text : JSON.stringify(spec.json ?? {});
  return new Response(body, {
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

// Build a mock Spotify embed HTML page wrapping the __NEXT_DATA__ JSON
// in the same shape spotify.com/embed/playlist/{id} returns.
function buildEmbedHtml(opts: {
  name?: string;
  tracks: Array<{ id: string; title?: string; artist?: string; durationMs?: number }>;
  omitTrackList?: boolean;
  malformedJson?: boolean;
}): string {
  const trackList = opts.tracks.map((t) => ({
    uri: `spotify:track:${t.id}`,
    title: t.title ?? `t-${t.id}`,
    subtitle: t.artist ?? "Artist",
    duration: t.durationMs ?? 1000,
    entityType: "track",
  }));
  const data = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              type: "playlist",
              name: opts.name ?? "Mock Playlist",
              ...(opts.omitTrackList ? {} : { trackList }),
            },
          },
        },
      },
    },
  };
  const json = opts.malformedJson ? "{ not json" : JSON.stringify(data);
  return `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

function mockEmbedResponse(opts: Parameters<typeof buildEmbedHtml>[0]): MockedResponse {
  return {
    status: 200,
    json: undefined,
    headers: { "content-type": "text/html" },
    text: buildEmbedHtml(opts),
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
      mockEmbedResponse({
        name: "My Mix",
        tracks: [{ id: "a" }, { id: "b" }, { id: "c" }],
      }),
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
    expect(playlist.source).toBe("SPOTIFY_IMPORT");
    expect(playlist.locked).toBe(true);
    expect(playlist.importedAt).toBeInstanceOf(Date);
    expect(playlist.sourceLabel).toBe("Spotify import");
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
      mockEmbedResponse({
        name: "Mix",
        tracks: [{ id: "a" }, { id: "b" }, { id: "c" }],
      }),
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
    const embedTracks = [{ id: "a" }, { id: "b" }];
    mockFetchSequence([
      mockEmbedResponse({ name: "Mix", tracks: embedTracks }),
      mockEmbedResponse({ name: "Mix", tracks: embedTracks }),
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

  it("404 with code playlist_not_visible_or_private when embed has no trackList", async () => {
    mockFetchSequence([
      mockEmbedResponse({ name: "Private Mix", tracks: [], omitTrackList: true }),
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("playlist_not_visible_or_private");
  });

  it("404 with code playlist_not_visible_or_private when embed JSON is malformed", async () => {
    mockFetchSequence([
      mockEmbedResponse({ tracks: [], malformedJson: true }),
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("playlist_not_visible_or_private");
  });

  it("502 with code upstream when embed endpoint returns 5xx", async () => {
    mockFetchSequence([
      { status: 503, text: "Service Unavailable" },
    ]);
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await importPOST(
      jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream");
  });

  it("empty playlist → 201 with empty Playlist row, songsImported = 0", async () => {
    mockFetchSequence([
      mockEmbedResponse({ name: "Empty", tracks: [] }),
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
      mockEmbedResponse({
        name: "Dups",
        tracks: [{ id: "a" }, { id: "a" }, { id: "b" }],
      }),
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

  it("caps auto-match triggers at 10 per import (default) (quota guard)", async () => {
    // Build a 30-track playlist; only the first 10 unmatched songs should
    // get triggerMatchInBackground called under the default cap.
    const embedTracks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}` }));
    mockFetchSequence([
      mockEmbedResponse({ name: "Big Mix", tracks: embedTracks }),
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

    // Cap kicks in: exactly 10 trigger calls, not 30.
    expect(triggerSpy).toHaveBeenCalledTimes(10);
  });

  it("respects SPOTIFY_IMPORT_AUTO_MATCH_LIMIT env override", async () => {
    const ORIGINAL = process.env.SPOTIFY_IMPORT_AUTO_MATCH_LIMIT;
    process.env.SPOTIFY_IMPORT_AUTO_MATCH_LIMIT = "3";
    try {
      const embedTracks = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}` }));
      mockFetchSequence([
        mockEmbedResponse({ name: "Tiny Cap", tracks: embedTracks }),
      ]);
      const u = await makeUser();
      await setUserSession(u.id);
      const res = await importPOST(
        jsonRequest("http://x/api/spotify/import-playlist", { url: PLAYLIST_URL }),
      );
      expect(res.status).toBe(201);
      expect(triggerSpy).toHaveBeenCalledTimes(3);
    } finally {
      process.env.SPOTIFY_IMPORT_AUTO_MATCH_LIMIT = ORIGINAL;
    }
  });

  it("falls back to 'Imported Spotify Playlist' when Spotify returns no name", async () => {
    mockFetchSequence([
      mockEmbedResponse({ name: "", tracks: [{ id: "a" }] }),
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
      mockEmbedResponse({ name: "Owned", tracks: [{ id: "a" }] }),
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
