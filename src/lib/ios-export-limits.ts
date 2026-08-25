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

/// Measured against the real production-shaped library (5 playlists, 373
/// memberships, 137,908 encoded bytes) => ~370 bytes per membership.
///
/// At that density a full 5,000-membership export is ~1.76 MB, which is 88% of
/// a 2 MB cap — so with 2 MB the byte check would fire before the membership
/// check on any library with slightly-above-average rows (long titles, several
/// alt ids), making MAX_SONG_MEMBERSHIPS unreachable in practice and rejecting
/// exports that are nominally within limits.
///
/// 4 MB keeps memberships the binding constraint and leaves bytes as a genuine
/// backstop against pathological rows. `limitsAreConsistent()` below is the
/// regression guard: it fails if a future edit re-crowds them.
export const MAX_ENCODED_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MB

/// Observed bytes-per-membership, with headroom over the 370 measured.
export const ESTIMATED_BYTES_PER_MEMBERSHIP = 512;

/// The byte cap must comfortably exceed the worst payload the membership cap
/// permits, or the two limits contradict each other.
export function limitsAreConsistent(): boolean {
  return (
    MAX_SONG_MEMBERSHIPS * ESTIMATED_BYTES_PER_MEMBERSHIP <=
    MAX_ENCODED_RESPONSE_BYTES
  );
}

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
