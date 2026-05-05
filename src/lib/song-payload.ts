import type { NormalizedTrack } from "@/types/api";

export function songPayloadFromTrack(track: NormalizedTrack) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    spotifyId: track.spotifyId,
  };
}
