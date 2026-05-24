import type { Playlist, User } from "@prisma/client";

export type { Playlist, User };

// Role and PlaylistSource are native Postgres enums (see `prisma/schema.prisma`).
// The string-literal unions below mirror those values for places that need
// the literal type without importing from `@prisma/client`.
export type Role = "OWNER" | "USER";
export type PlaylistSource = "MANUAL" | "SPOTIFY_IMPORT" | "CLONE";

// Wire-shape Song. Matches the Prisma row directly on this branch — Postgres
// stores `youtubeAltIds` as a native `text[]`, so no JSON encoding step is
// needed. `normalizeSong()` in `src/lib/song-serialization.ts` is an identity
// pass-through kept for call-site parity with the SQLite branch.
export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  spotifyId: string | null;
  youtubeId: string | null;
  youtubeAltIds: string[];
  youtubeMatchType: string | null;
  youtubeMatchReason: string | null;
  youtubeMatchTitle: string | null;
  youtubeMatchChannel: string | null;
  createdAt: Date | string;
};

export type MeResponse =
  | {
      role: "OWNER";
      actingUserId?: string;
      actingUserName?: string;
    }
  | {
      role: "USER";
      userId: string;
      name: string;
    };

export type NormalizedTrack = {
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  albumImageUrl: string | null;
};

export type PlaylistWithCount = Playlist & {
  _count: { songs: number };
};

export type PlaylistWithSongs = Playlist & {
  songs: Array<{ order: number; song: Song }>;
};

export type SearchResponse = { tracks: NormalizedTrack[] };

export type ListPlaylistsResponse = { playlists: PlaylistWithCount[] };

export type ListUsersResponse = { users: User[] };

export type SongResponse = { song: Song };

export type PlaylistResponse = { playlist: Playlist };

export type ImportPlaylistResponse = {
  playlist: { id: string; name: string };
  songsImported: number;
  songsReused: number;
};

// === YouTube search ========================================================

export type YoutubeSearchResult = {
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  url: string;
  thumbnailUrl: string | null;
};

export type QuotaStatus = {
  remainingUnits: number;
  remainingSearches: number;
  resetsAt: string;
};

export type YoutubeSearchResponse = {
  results: YoutubeSearchResult[];
  quota: QuotaStatus;
};
