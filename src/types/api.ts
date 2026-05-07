import type { Playlist, User } from "@prisma/client";

export type { Playlist, User };

// Role and PlaylistSource are stored as String columns on SQLite (Prisma's
// SQLite provider has no enum support). The string-literal unions below are
// the single source of truth for valid values; app code should validate
// against them at every write site.
export type Role = "OWNER" | "USER";
export type PlaylistSource = "MANUAL" | "SPOTIFY_IMPORT" | "CLONE";

// Wire-shape Song. The DB row has `youtubeAltIdsJson: string`; API responses
// expose `youtubeAltIds: string[]` via `normalizeSong` in
// `src/lib/song-serialization.ts`. Defining the wire type here (instead of
// re-exporting Prisma's row type) means any route that forgets to normalize
// will type-error, since the raw row has the wrong field name.
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
