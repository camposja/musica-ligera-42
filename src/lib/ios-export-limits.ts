/// Hard bounds on a single export request.
///
/// Named constants rather than adjectives so they are testable and adjustable
/// in one place. The whole request is rejected up front when any bound would be
/// exceeded — we never export a truncated payload, because iOS decodes and
/// writes the document in one transaction and a partial body would commit as a
/// successful-looking partial import.
///
/// Deliberately NOT streamed or paginated for the same reason.
export const MAX_PLAYLISTS_PER_EXPORT = 50;
export const MAX_SONG_MEMBERSHIPS = 5_000;
export const MAX_ENCODED_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

export type LimitBreach =
  | { limit: "playlists"; max: number; actual: number }
  | { limit: "memberships"; max: number; actual: number }
  | { limit: "bytes"; max: number; actual: number };

export function checkPlaylistCount(count: number): LimitBreach | null {
  return count > MAX_PLAYLISTS_PER_EXPORT
    ? { limit: "playlists", max: MAX_PLAYLISTS_PER_EXPORT, actual: count }
    : null;
}

export function checkMembershipCount(count: number): LimitBreach | null {
  return count > MAX_SONG_MEMBERSHIPS
    ? { limit: "memberships", max: MAX_SONG_MEMBERSHIPS, actual: count }
    : null;
}

export function checkEncodedSize(bytes: number): LimitBreach | null {
  return bytes > MAX_ENCODED_RESPONSE_BYTES
    ? { limit: "bytes", max: MAX_ENCODED_RESPONSE_BYTES, actual: bytes }
    : null;
}
