import type { Playlist, Song, User } from "@prisma/client";

export type { Playlist, Song, User };

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
