export type NormalizedTrack = {
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  albumImageUrl: string | null;
};

export class SpotifyError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const REFRESH_BUFFER_MS = 60_000;
const MAX_PLAYLIST_PAGES = 50;

type SpotifyToken = { token: string; expiresAt: number };
let cachedToken: SpotifyToken | null = null;

export function _resetTokenCacheForTests(): void {
  cachedToken = null;
}

function getCreds(): { id: string; secret: string } {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SpotifyError(
      0,
      "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set",
    );
  }
  return { id, secret };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - REFRESH_BUFFER_MS > now) {
    return cachedToken.token;
  }
  const { id, secret } = getCreds();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new SpotifyError(
      res.status,
      `Spotify token request failed: ${res.status}`,
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.token;
}

async function spotifyFetch(url: string): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new SpotifyError(
      429,
      "Spotify rate limit",
      retryAfter ? Number(retryAfter) : undefined,
    );
  }
  if (!res.ok) {
    throw new SpotifyError(res.status, `Spotify API error: ${res.status}`);
  }
  return res;
}

type SpotifyArtistRef = { name: string };
type SpotifyImage = { url: string; width?: number; height?: number };
type SpotifyAlbum = { name: string; images?: SpotifyImage[] };
type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  artists: SpotifyArtistRef[];
  album?: SpotifyAlbum;
  is_local?: boolean;
  type?: string;
};
type SpotifyPlaylistItem = { track: SpotifyTrack | null };
type SpotifyPaged<T> = { items: T[]; next: string | null };

function normalize(track: SpotifyTrack): NormalizedTrack {
  const artist =
    track.artists && track.artists.length > 0
      ? track.artists.map((a) => a.name).join(", ")
      : "Unknown";
  const album = track.album?.name ?? null;
  const albumImageUrl = track.album?.images?.[0]?.url ?? null;
  return {
    spotifyId: track.id,
    title: track.name,
    artist,
    album,
    durationMs: track.duration_ms,
    albumImageUrl,
  };
}

export async function searchTracks(
  q: string,
  limit = 20,
): Promise<NormalizedTrack[]> {
  const url = `${API_BASE}/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`;
  const res = await spotifyFetch(url);
  const json = (await res.json()) as {
    tracks?: { items: SpotifyTrack[] };
  };
  const items = json.tracks?.items ?? [];
  return items.filter((t) => t && t.id).map(normalize);
}

export async function getPlaylist(
  playlistId: string,
): Promise<{ name: string }> {
  const url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}?fields=name`;
  const res = await spotifyFetch(url);
  const json = (await res.json()) as { name?: string };
  return { name: json.name ?? "" };
}

export async function getAllPlaylistTracks(
  playlistId: string,
): Promise<NormalizedTrack[]> {
  const fields =
    "items(track(id,name,duration_ms,is_local,type,artists(name),album(name,images))),next";
  let url: string | null =
    `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const out: NormalizedTrack[] = [];
  let pages = 0;
  while (url) {
    if (++pages > MAX_PLAYLIST_PAGES) {
      throw new SpotifyError(
        413,
        `Playlist exceeds ${MAX_PLAYLIST_PAGES} pages of tracks`,
      );
    }
    const res = await spotifyFetch(url);
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

const PLAYLIST_ID_RE = /^[A-Za-z0-9]{22}$/;

export function parseSpotifyPlaylistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (PLAYLIST_ID_RE.test(trimmed)) return trimmed;
  const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  try {
    const u = new URL(trimmed);
    if (
      (u.hostname === "open.spotify.com" || u.hostname === "spotify.com") &&
      u.pathname.startsWith("/playlist/")
    ) {
      const id = u.pathname.slice("/playlist/".length).split("/")[0];
      if (PLAYLIST_ID_RE.test(id)) return id;
    }
  } catch {
    // not a valid URL; fall through
  }
  return null;
}
