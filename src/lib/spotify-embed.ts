import { SpotifyError, type NormalizedTrack } from "@/lib/spotify";

// Spotify's official Web API blocks /playlists/{id}/tracks for apps in
// Development Mode (Nov 2024 policy). The public embed iframe at
// https://open.spotify.com/embed/playlist/{id} returns a __NEXT_DATA__
// JSON blob containing the full track list, with no auth required. This
// is the same content Spotify hands out for blog/site embeds, so it's
// publicly served — but it's not a stable contract. If Spotify changes
// the embed page structure this will break and we'll need to update
// the parser. Acceptable trade for an MVP that needs to actually import
// playlists.

const EMBED_URL = "https://open.spotify.com/embed/playlist/";
const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const TRACK_URI_RE = /^spotify:track:([A-Za-z0-9]+)$/;

type EmbedTrack = {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  entityType?: string;
};

export class PlaylistNotVisibleError extends Error {
  constructor() {
    super("Playlist data is not exposed in Spotify's public embed");
    this.name = "PlaylistNotVisibleError";
  }
}

function findKey<T>(obj: unknown, key: string, depth = 0): T | null {
  if (depth > 15 || obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findKey<T>(v, key, depth + 1);
      if (r !== null) return r;
    }
    return null;
  }
  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (key in o) return o[key] as T;
  for (const v of Object.values(o)) {
    const r = findKey<T>(v, key, depth + 1);
    if (r !== null) return r;
  }
  return null;
}

function normalizeEmbedTrack(t: EmbedTrack): NormalizedTrack | null {
  if (!t.uri) return null;
  const m = TRACK_URI_RE.exec(t.uri);
  if (!m) return null;
  if (t.entityType && t.entityType !== "track") return null;
  return {
    spotifyId: m[1],
    title: t.title ?? "Unknown",
    artist: t.subtitle ?? "Unknown",
    album: null,
    durationMs: typeof t.duration === "number" ? t.duration : 0,
    albumImageUrl: null,
  };
}

export async function getPlaylistFromEmbed(
  playlistId: string,
): Promise<{ name: string; tracks: NormalizedTrack[] }> {
  const url = `${EMBED_URL}${encodeURIComponent(playlistId)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (musica-ligera-42)" },
  });
  if (!res.ok) {
    console.error("[spotify-embed] upstream error", {
      url,
      status: res.status,
      statusText: res.statusText,
    });
    throw new SpotifyError(res.status, `Spotify embed error: ${res.status}`);
  }
  const html = await res.text();
  const m = NEXT_DATA_RE.exec(html);
  if (!m) {
    console.error("[spotify-embed] no __NEXT_DATA__ block found", {
      url,
      sizeBytes: html.length,
    });
    throw new PlaylistNotVisibleError();
  }
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    console.error("[spotify-embed] failed to parse __NEXT_DATA__", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PlaylistNotVisibleError();
  }
  const trackList = findKey<EmbedTrack[]>(data, "trackList");
  if (!trackList || !Array.isArray(trackList)) {
    console.error("[spotify-embed] no trackList in __NEXT_DATA__", { url });
    throw new PlaylistNotVisibleError();
  }
  const name = findKey<string>(data, "name") ?? "";
  const tracks: NormalizedTrack[] = [];
  for (const t of trackList) {
    const n = normalizeEmbedTrack(t);
    if (n) tracks.push(n);
  }
  return { name, tracks };
}
