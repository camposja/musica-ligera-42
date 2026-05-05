import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  API_BASE,
  MAX_PLAYLIST_PAGES,
  REFRESH_BUFFER_MS,
  SpotifyError,
  TOKEN_URL,
  normalize,
  readBodySafe,
  type NormalizedTrack,
  type SpotifyPaged,
  type SpotifyPlaylistItem,
} from "@/lib/spotify";

export const SPOTIFY_SCOPES = "playlist-read-private playlist-read-collaborative";
export const STATE_COOKIE_NAME = "ml42_spotify_oauth_state";
const STATE_TTL_SECONDS = 5 * 60;
const SINGLETON_ID = "singleton";

export class NotConnectedError extends Error {
  constructor() {
    super("Spotify is not connected");
    this.name = "NotConnectedError";
  }
}

export class ReconnectRequiredError extends Error {
  constructor() {
    super("Spotify connection requires reconnect");
    this.name = "ReconnectRequiredError";
  }
}

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

function getJwtSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

function getOauthCreds(): { id: string; secret: string; redirectUri: string } {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!id || !secret || !redirectUri) {
    throw new SpotifyError(
      0,
      "Spotify OAuth not configured: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI must be set",
    );
  }
  return { id, secret, redirectUri };
}

export async function signOauthState(): Promise<{ state: string; jwt: string }> {
  const state = randomBytes(32).toString("hex");
  const jwt = await new SignJWT({ s: state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(getJwtSecret());
  return { state, jwt };
}

export async function verifyOauthStateJwt(
  jwt: string,
  claimedState: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(jwt, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    const s = (payload as { s?: unknown }).s;
    return typeof s === "string" && s === claimedState;
  } catch {
    return false;
  }
}

export async function setOauthStateCookie(jwt: string): Promise<void> {
  const store = await cookies();
  store.set(STATE_COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function readOauthStateCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(STATE_COOKIE_NAME)?.value ?? null;
}

export async function clearOauthStateCookie(): Promise<void> {
  const store = await cookies();
  store.set(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function buildAuthorizeUrl(state: string): string {
  const { id, redirectUri } = getOauthCreds();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function postTokenEndpoint(body: URLSearchParams): Promise<TokenResponse> {
  const { id, secret } = getOauthCreds();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await readBodySafe(res);
    let parsed: { error?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {}
    console.error("[spotify-oauth] token endpoint error", {
      grantType: body.get("grant_type"),
      status: res.status,
      statusText: res.statusText,
      body: text,
    });
    if (
      body.get("grant_type") === "refresh_token" &&
      (res.status === 400 || res.status === 401) &&
      parsed.error === "invalid_grant"
    ) {
      await prisma.spotifyConnection.deleteMany({});
      throw new ReconnectRequiredError();
    }
    throw new SpotifyError(res.status, `Spotify token endpoint error: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { redirectUri } = getOauthCreds();
  return postTokenEndpoint(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  return postTokenEndpoint(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

export async function tryFetchSpotifyUserId(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { id?: string };
    return typeof json.id === "string" ? json.id : null;
  } catch {
    return null;
  }
}

export async function upsertConnection(
  tokens: TokenResponse,
  spotifyUserId: string | null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new SpotifyError(
      0,
      "Spotify did not return a refresh_token on authorization_code exchange",
    );
  }
  await prisma.spotifyConnection.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt,
      scope: tokens.scope ?? SPOTIFY_SCOPES,
      spotifyUserId,
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt,
      scope: tokens.scope ?? SPOTIFY_SCOPES,
      spotifyUserId,
    },
  });
}

export async function getValidConnectionToken(): Promise<string> {
  const conn = await prisma.spotifyConnection.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (!conn) throw new NotConnectedError();
  const now = Date.now();
  if (conn.expiresAt.getTime() - REFRESH_BUFFER_MS > now) {
    return conn.accessToken;
  }
  const tokens = await refreshAccessToken(conn.refreshToken);
  const newRefreshToken = tokens.refresh_token ?? conn.refreshToken;
  await prisma.spotifyConnection.update({
    where: { id: SINGLETON_ID },
    data: {
      accessToken: tokens.access_token,
      refreshToken: newRefreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope ?? conn.scope,
    },
  });
  return tokens.access_token;
}

async function spotifyConnectionFetch(input: string): Promise<Response> {
  const token = await getValidConnectionToken();
  const url = input.startsWith("http") ? input : `${API_BASE}${input}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    console.error("[spotify-oauth] rate limited", { url, retryAfter });
    throw new SpotifyError(
      429,
      "Spotify rate limit",
      retryAfter ? Number(retryAfter) : undefined,
    );
  }
  if (!res.ok) {
    const body = await readBodySafe(res);
    console.error("[spotify-oauth] upstream error", {
      url,
      status: res.status,
      statusText: res.statusText,
      body,
    });
    throw new SpotifyError(res.status, `Spotify API error: ${res.status}`);
  }
  return res;
}

export async function getPlaylistAsConnection(
  playlistId: string,
): Promise<{ name: string }> {
  const res = await spotifyConnectionFetch(
    `/playlists/${encodeURIComponent(playlistId)}?fields=name`,
  );
  const json = (await res.json()) as { name?: string };
  return { name: json.name ?? "" };
}

export async function getAllPlaylistTracksAsConnection(
  playlistId: string,
): Promise<NormalizedTrack[]> {
  const fields =
    "items(track(id,name,duration_ms,is_local,type,artists(name),album(name,images))),next";
  let url: string | null = `${API_BASE}/playlists/${encodeURIComponent(
    playlistId,
  )}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const out: NormalizedTrack[] = [];
  let pages = 0;
  while (url) {
    if (++pages > MAX_PLAYLIST_PAGES) {
      throw new SpotifyError(
        413,
        `Playlist exceeds ${MAX_PLAYLIST_PAGES} pages of tracks`,
      );
    }
    const res = await spotifyConnectionFetch(url);
    const page = (await res.json()) as SpotifyPaged<SpotifyPlaylistItem>;
    for (const item of page.items) {
      const t = item.track;
      if (!t || !t.id || t.is_local || (t.type && t.type !== "track")) continue;
      out.push(normalize(t));
    }
    url = page.next;
  }
  return out;
}

export async function isConnected(): Promise<boolean> {
  const c = await prisma.spotifyConnection.count();
  return c > 0;
}

export async function getConnectionInfo(): Promise<{
  connected: boolean;
  spotifyUserId: string | null;
}> {
  const conn = await prisma.spotifyConnection.findUnique({
    where: { id: SINGLETON_ID },
    select: { spotifyUserId: true },
  });
  return { connected: !!conn, spotifyUserId: conn?.spotifyUserId ?? null };
}

export async function deleteConnection(): Promise<void> {
  await prisma.spotifyConnection.deleteMany({});
}
