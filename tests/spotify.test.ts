import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stash + restore Spotify env so the test process's setup-env values don't leak
// into tests, and so the missing-creds case can be exercised explicitly.
const ORIGINAL_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIGINAL_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = "test_client_id";
  process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.SPOTIFY_CLIENT_ID = ORIGINAL_ID;
  process.env.SPOTIFY_CLIENT_SECRET = ORIGINAL_SECRET;
});

import {
  _resetTokenCacheForTests,
  getAllPlaylistTracks,
  getPlaylist,
  parseSpotifyPlaylistId,
  searchTracks,
  SpotifyError,
} from "@/lib/spotify";

beforeEach(() => {
  _resetTokenCacheForTests();
});

// --- fetch mock helpers ------------------------------------------------------

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
  return {
    status: 200,
    json: { access_token: "tok-abc", expires_in: 3600 },
  };
}

/**
 * Queue a sequence of fetch responses; each call to fetch returns the next.
 * Throws if exhausted unexpectedly.
 */
function mockFetchSequence(responses: MockedResponse[]): ReturnType<typeof vi.spyOn> {
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

// --- parseSpotifyPlaylistId -------------------------------------------------

describe("parseSpotifyPlaylistId", () => {
  const ID = "37i9dQZF1DXcBWIGoYBM5M";

  it("parses open.spotify.com URL", () => {
    expect(parseSpotifyPlaylistId(`https://open.spotify.com/playlist/${ID}`)).toBe(ID);
  });

  it("parses open.spotify.com URL with ?si= query string", () => {
    expect(
      parseSpotifyPlaylistId(`https://open.spotify.com/playlist/${ID}?si=abc123`),
    ).toBe(ID);
  });

  it("parses spotify:playlist:{id} URI", () => {
    expect(parseSpotifyPlaylistId(`spotify:playlist:${ID}`)).toBe(ID);
  });

  it("accepts a bare 22-char id", () => {
    expect(parseSpotifyPlaylistId(ID)).toBe(ID);
  });

  it("rejects empty string", () => {
    expect(parseSpotifyPlaylistId("")).toBeNull();
  });

  it("rejects unrelated URLs", () => {
    expect(parseSpotifyPlaylistId("https://example.com/playlist/abc")).toBeNull();
  });

  it("rejects malformed URI", () => {
    expect(parseSpotifyPlaylistId("spotify:track:xyz")).toBeNull();
  });

  it("rejects ids of wrong length", () => {
    expect(parseSpotifyPlaylistId("abc123")).toBeNull();
  });
});

// --- token cache ------------------------------------------------------------

describe("getAccessToken caching (via searchTracks)", () => {
  it("first call fetches a token; subsequent call within expiry reuses it", async () => {
    const search = {
      status: 200,
      json: { tracks: { items: [] } },
    };
    const spy = mockFetchSequence([
      tokenResponse(), // first call: token
      search,
      search, // second call: search only — no second token request
    ]);

    await searchTracks("a");
    await searchTracks("b");

    expect(spy).toHaveBeenCalledTimes(3);
    const tokenCalls = spy.mock.calls.filter((c) =>
      String(c[0]).includes("accounts.spotify.com/api/token"),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("refreshes after expiry", async () => {
    // First token expires in 1s; refresh buffer is 60s, so it's "expired" immediately.
    const expiredToken: MockedResponse = {
      status: 200,
      json: { access_token: "expired", expires_in: 1 },
    };
    const search: MockedResponse = {
      status: 200,
      json: { tracks: { items: [] } },
    };
    const spy = mockFetchSequence([
      expiredToken,
      search,
      tokenResponse(), // second token request because the first is "expired"
      search,
    ]);

    await searchTracks("a");
    await searchTracks("b");

    const tokenCalls = spy.mock.calls.filter((c) =>
      String(c[0]).includes("accounts.spotify.com/api/token"),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws SpotifyError(0, ...) when creds are missing", async () => {
    process.env.SPOTIFY_CLIENT_ID = "";
    process.env.SPOTIFY_CLIENT_SECRET = "";
    await expect(searchTracks("a")).rejects.toMatchObject({
      name: "SpotifyError",
      httpStatus: 0,
    });
  });
});

// --- searchTracks normalization --------------------------------------------

describe("searchTracks", () => {
  it("normalizes Spotify track shape to NormalizedTrack[]", async () => {
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
                  images: [{ url: "https://img/cover.jpg", width: 640 }],
                },
              },
            ],
          },
        },
      },
    ]);

    const tracks = await searchTracks("hello");
    expect(tracks).toEqual([
      {
        spotifyId: "abc",
        title: "Hello",
        artist: "Adele",
        album: "25",
        durationMs: 1234,
        albumImageUrl: "https://img/cover.jpg",
      },
    ]);
  });

  it("joins multiple artists with ', '", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          tracks: {
            items: [
              {
                id: "x",
                name: "Duet",
                duration_ms: 0,
                artists: [{ name: "A" }, { name: "B" }],
                album: { name: "Album" },
              },
            ],
          },
        },
      },
    ]);
    const [t] = await searchTracks("x");
    expect(t.artist).toBe("A, B");
  });

  it("returns null albumImageUrl when no images present", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          tracks: {
            items: [
              {
                id: "x",
                name: "n",
                duration_ms: 0,
                artists: [{ name: "a" }],
                album: { name: "alb" },
              },
            ],
          },
        },
      },
    ]);
    const [t] = await searchTracks("x");
    expect(t.albumImageUrl).toBeNull();
  });

  it("filters items missing an id", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          tracks: {
            items: [
              null,
              { id: "ok", name: "n", duration_ms: 0, artists: [{ name: "a" }] },
            ],
          },
        },
      },
    ]);
    const tracks = await searchTracks("x");
    expect(tracks).toHaveLength(1);
    expect(tracks[0].spotifyId).toBe("ok");
  });
});

// --- getPlaylist ------------------------------------------------------------

describe("getPlaylist", () => {
  it("returns the playlist name", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 200, json: { name: "Hot 100" } },
    ]);
    const meta = await getPlaylist("abc");
    expect(meta.name).toBe("Hot 100");
  });

  it("maps Spotify 404 to SpotifyError(404)", async () => {
    mockFetchSequence([tokenResponse(), { status: 404, json: { error: "not found" } }]);
    await expect(getPlaylist("missing")).rejects.toMatchObject({
      name: "SpotifyError",
      httpStatus: 404,
    });
  });

  it("maps Spotify 429 with Retry-After to SpotifyError(429, retryAfterSeconds)", async () => {
    mockFetchSequence([
      tokenResponse(),
      { status: 429, json: {}, headers: { "retry-after": "12" } },
    ]);
    await expect(getPlaylist("limited")).rejects.toMatchObject({
      name: "SpotifyError",
      httpStatus: 429,
      retryAfterSeconds: 12,
    });
  });
});

// --- getAllPlaylistTracks pagination ---------------------------------------

describe("getAllPlaylistTracks", () => {
  function makeTrack(id: string, name = `t-${id}`) {
    return {
      track: {
        id,
        name,
        duration_ms: 1000,
        artists: [{ name: "a" }],
        album: { name: "alb" },
      },
    };
  }

  it("returns single-page tracks", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: { items: [makeTrack("a"), makeTrack("b")], next: null },
      },
    ]);
    const tracks = await getAllPlaylistTracks("p");
    expect(tracks.map((t) => t.spotifyId)).toEqual(["a", "b"]);
  });

  it("follows next link across multiple pages", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          items: [makeTrack("a")],
          next: "https://api.spotify.com/v1/playlists/p/tracks?offset=1",
        },
      },
      {
        status: 200,
        json: { items: [makeTrack("b"), makeTrack("c")], next: null },
      },
    ]);
    const tracks = await getAllPlaylistTracks("p");
    expect(tracks.map((t) => t.spotifyId)).toEqual(["a", "b", "c"]);
  });

  it("filters out null tracks (removed items) and is_local", async () => {
    mockFetchSequence([
      tokenResponse(),
      {
        status: 200,
        json: {
          items: [
            { track: null },
            makeTrack("ok"),
            {
              track: {
                id: "loc",
                name: "x",
                duration_ms: 0,
                artists: [],
                album: { name: "" },
                is_local: true,
              },
            },
          ],
          next: null,
        },
      },
    ]);
    const tracks = await getAllPlaylistTracks("p");
    expect(tracks.map((t) => t.spotifyId)).toEqual(["ok"]);
  });
});

// --- SpotifyError class -----------------------------------------------------

describe("SpotifyError", () => {
  it("constructs with status, message, optional retry-after", () => {
    const e = new SpotifyError(429, "rate limited", 7);
    expect(e.name).toBe("SpotifyError");
    expect(e.httpStatus).toBe(429);
    expect(e.message).toBe("rate limited");
    expect(e.retryAfterSeconds).toBe(7);
    expect(e instanceof Error).toBe(true);
  });
});
