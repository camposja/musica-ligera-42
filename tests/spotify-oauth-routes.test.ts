import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCookies,
  emptyRequest,
  prisma,
  seedSpotifyConnection,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

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

import { GET as connectGET } from "@/app/api/spotify/connect/route";
import { GET as callbackGET } from "@/app/api/spotify/callback/route";
import { GET as statusGET } from "@/app/api/spotify/status/route";
import { POST as disconnectPOST } from "@/app/api/spotify/disconnect/route";
import {
  STATE_COOKIE_NAME,
  signOauthState,
  setOauthStateCookie,
} from "@/lib/spotify-oauth";

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

async function makeUser(name = "alice") {
  return prisma.user.create({ data: { name, role: "USER", accessCode: "x" } });
}

async function readCookieValue(name: string): Promise<string | undefined> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return store.get(name)?.value;
}

// === GET /api/spotify/connect ===========================================

describe("GET /api/spotify/connect", () => {
  it("401 without session", async () => {
    const res = await connectGET();
    expect(res.status).toBe(401);
  });

  it("403 for USER session", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await connectGET();
    expect(res.status).toBe(403);
  });

  it("redirects OWNER to Spotify authorize URL and sets state cookie", async () => {
    await setOwnerSession();
    const res = await connectGET();
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("https://accounts.spotify.com/authorize?")).toBe(true);
    expect(loc).toContain("client_id=test_client_id");
    expect(loc).toContain("response_type=code");
    expect(loc).toContain("scope=playlist-read-private");
    expect(loc).toContain("redirect_uri=");
    expect(loc).toMatch(/state=[a-f0-9]+/);
    const cookieJwt = await readCookieValue(STATE_COOKIE_NAME);
    expect(typeof cookieJwt).toBe("string");
    expect(cookieJwt!.length).toBeGreaterThan(0);
  });
});

// === GET /api/spotify/callback ==========================================

describe("GET /api/spotify/callback", () => {
  function callbackUrl(params: Record<string, string>): string {
    const u = new URL("http://localhost:3000/api/spotify/callback");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  it("user denied → redirects to /dashboard?spotify=forbidden and clears state cookie", async () => {
    await setOwnerSession();
    const { jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    const res = await callbackGET(
      new Request(callbackUrl({ error: "access_denied" })),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/dashboard?spotify=forbidden");
    const cookie = await readCookieValue(STATE_COOKIE_NAME);
    expect(cookie ?? "").toBe("");
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });

  it("403 + clears state cookie when not OWNER", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const { state, jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state })),
    );
    expect(res.status).toBe(403);
    const cookie = await readCookieValue(STATE_COOKIE_NAME);
    expect(cookie ?? "").toBe("");
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });

  it("400 when state cookie is missing", async () => {
    await setOwnerSession();
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state: "anything" })),
    );
    expect(res.status).toBe(400);
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });

  it("400 + clears cookie when state value mismatches", async () => {
    await setOwnerSession();
    const { jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state: "wrong-state-value" })),
    );
    expect(res.status).toBe(400);
    const cookie = await readCookieValue(STATE_COOKIE_NAME);
    expect(cookie ?? "").toBe("");
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });

  it("happy path: exchanges code, stores tokens + spotifyUserId, clears cookie, redirects connected", async () => {
    await setOwnerSession();
    const { state, jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    mockFetchSequence([
      // token exchange
      {
        status: 200,
        json: {
          access_token: "AT",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "RT",
          scope: "playlist-read-private playlist-read-collaborative",
        },
      },
      // /v1/me lookup
      { status: 200, json: { id: "spotify_user_42" } },
    ]);
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state })),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/dashboard?spotify=connected");
    const cookie = await readCookieValue(STATE_COOKIE_NAME);
    expect(cookie ?? "").toBe("");
    const conn = await prisma.spotifyConnection.findUnique({
      where: { id: "singleton" },
    });
    expect(conn).not.toBeNull();
    expect(conn!.accessToken).toBe("AT");
    expect(conn!.refreshToken).toBe("RT");
    expect(conn!.spotifyUserId).toBe("spotify_user_42");
  });

  it("stores null spotifyUserId when /v1/me fails (no extra scope added)", async () => {
    await setOwnerSession();
    const { state, jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    mockFetchSequence([
      {
        status: 200,
        json: {
          access_token: "AT",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "RT",
        },
      },
      // /v1/me returns 401 — store null
      { status: 401, json: { error: "no" } },
    ]);
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state })),
    );
    expect(res.status).toBe(302);
    const conn = await prisma.spotifyConnection.findUnique({
      where: { id: "singleton" },
    });
    expect(conn!.spotifyUserId).toBeNull();
  });

  it("token exchange failure → redirects /dashboard?spotify=error and clears cookie", async () => {
    await setOwnerSession();
    const { state, jwt } = await signOauthState();
    await setOauthStateCookie(jwt);
    mockFetchSequence([
      { status: 400, json: { error: "invalid_request" } },
    ]);
    const res = await callbackGET(
      new Request(callbackUrl({ code: "abc", state })),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/dashboard?spotify=error");
    const cookie = await readCookieValue(STATE_COOKIE_NAME);
    expect(cookie ?? "").toBe("");
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });
});

// === Refresh logic (lib-level — import flow no longer uses OAuth tokens) ===
//
// Import was pivoted to scraping the public Spotify embed iframe (see
// spotify-embed.ts). The OAuth connection + refresh code is still in the
// codebase for future features (e.g. reading user-private data) so we test
// the refresh contract directly against getValidConnectionToken().

describe("Refresh logic via getValidConnectionToken()", () => {
  it("refreshes the access token transparently when expired and persists new tokens", async () => {
    await seedSpotifyConnection({
      accessToken: "OLD",
      refreshToken: "OLD_RT",
      expiresAt: new Date(Date.now() - 10_000), // already expired
    });
    mockFetchSequence([
      {
        status: 200,
        json: {
          access_token: "NEW",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "NEW_RT", // rotation honored
        },
      },
    ]);
    const { getValidConnectionToken } = await import("@/lib/spotify-oauth");
    const tok = await getValidConnectionToken();
    expect(tok).toBe("NEW");
    const conn = await prisma.spotifyConnection.findUnique({
      where: { id: "singleton" },
    });
    expect(conn!.accessToken).toBe("NEW");
    expect(conn!.refreshToken).toBe("NEW_RT");
  });

  it("keeps existing refresh_token when Spotify omits it on refresh", async () => {
    await seedSpotifyConnection({
      accessToken: "OLD",
      refreshToken: "ORIGINAL_RT",
      expiresAt: new Date(Date.now() - 10_000),
    });
    mockFetchSequence([
      // refresh response with no refresh_token
      {
        status: 200,
        json: { access_token: "NEW", token_type: "Bearer", expires_in: 3600 },
      },
    ]);
    const { getValidConnectionToken } = await import("@/lib/spotify-oauth");
    const tok = await getValidConnectionToken();
    expect(tok).toBe("NEW");
    const conn = await prisma.spotifyConnection.findUnique({
      where: { id: "singleton" },
    });
    expect(conn!.refreshToken).toBe("ORIGINAL_RT");
  });

  it("invalid_grant on refresh deletes the connection and throws ReconnectRequiredError", async () => {
    await seedSpotifyConnection({
      accessToken: "OLD",
      refreshToken: "DEAD_RT",
      expiresAt: new Date(Date.now() - 10_000),
    });
    mockFetchSequence([{ status: 400, json: { error: "invalid_grant" } }]);
    const { getValidConnectionToken, ReconnectRequiredError } = await import(
      "@/lib/spotify-oauth"
    );
    await expect(getValidConnectionToken()).rejects.toBeInstanceOf(
      ReconnectRequiredError,
    );
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });
});

// === GET /api/spotify/status ============================================

describe("GET /api/spotify/status", () => {
  it("401 without session", async () => {
    const res = await statusGET();
    expect(res.status).toBe(401);
  });

  it("returns {connected:false} when no row", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await statusGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: false, spotifyUserId: null });
  });

  it("returns {connected:true, spotifyUserId} when row exists; never returns tokens", async () => {
    await seedSpotifyConnection();
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await statusGET();
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.spotifyUserId).toBe("test_spotify_user");
    // No token leakage
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });
});

// === POST /api/spotify/disconnect =======================================

describe("POST /api/spotify/disconnect", () => {
  it("401 without session", async () => {
    const res = await disconnectPOST();
    expect(res.status).toBe(401);
  });

  it("403 for USER session", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await disconnectPOST();
    expect(res.status).toBe(403);
  });

  it("OWNER deletes the singleton row", async () => {
    await seedSpotifyConnection();
    expect(await prisma.spotifyConnection.count()).toBe(1);
    await setOwnerSession();
    const res = await disconnectPOST();
    expect(res.status).toBe(200);
    expect(await prisma.spotifyConnection.count()).toBe(0);
  });
});
