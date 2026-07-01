import { normalize } from "@/lib/youtube-match";

// Local library ranking. Pure + generic so routes and tests can share it. Mirrors
// the iOS intent (title > artist > album weighting) without SQLite FTS5: we fetch
// the user's candidate rows and rank them in JS. Match tiers: exact > prefix >
// substring; a multi-word query also matches when every token is present (as a
// whole word or prefix) across the row's text.

export type RankableSong = { title: string; artist: string; album: string | null };
export type RankablePlaylist = { name: string };

// 3 = exact, 2 = prefix, 1 = substring, 0 = none — against the normalized query.
function tier(field: string, qNorm: string): number {
  const f = normalize(field);
  if (!f || !qNorm) return 0;
  if (f === qNorm) return 3;
  if (f.startsWith(qNorm)) return 2;
  if (f.includes(qNorm)) return 1;
  return 0;
}

// Fraction of query tokens present (as whole word or prefix) in `combined`.
function tokenCoverage(combined: string, qTokens: string[]): number {
  if (qTokens.length === 0) return 0;
  const words = normalize(combined).split(" ").filter(Boolean);
  let hit = 0;
  for (const tk of qTokens) {
    if (words.some((w) => w === tk || w.startsWith(tk))) hit++;
  }
  return hit / qTokens.length;
}

function tokensOf(qNorm: string): string[] {
  return qNorm.split(" ").filter(Boolean);
}

export function scoreSong(song: RankableSong, qNorm: string, qTokens: string[]): number {
  const fieldScore =
    tier(song.title, qNorm) * 100 +
    tier(song.artist, qNorm) * 20 +
    (song.album ? tier(song.album, qNorm) * 3 : 0);
  const cov = tokenCoverage(
    `${song.title} ${song.artist} ${song.album ?? ""}`,
    qTokens,
  );
  // Qualify on any field-tier hit, or when all query tokens are covered.
  if (fieldScore === 0 && cov < 1) return 0;
  return fieldScore + cov * 10;
}

export function scorePlaylist(
  playlist: RankablePlaylist,
  qNorm: string,
  qTokens: string[],
): number {
  const name = tier(playlist.name, qNorm);
  const cov = tokenCoverage(playlist.name, qTokens);
  if (name === 0 && cov < 1) return 0;
  return name * 10 + cov * 5;
}

export function rankSongs<T extends RankableSong>(
  query: string,
  songs: T[],
  limit = 50,
): T[] {
  const qNorm = normalize(query);
  const qTokens = tokensOf(qNorm);
  return songs
    .map((s) => ({ s, score: scoreSong(s, qNorm, qTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

export function rankPlaylists<T extends RankablePlaylist>(
  query: string,
  playlists: T[],
  limit = 20,
): T[] {
  const qNorm = normalize(query);
  const qTokens = tokensOf(qNorm);
  return playlists
    .map((p) => ({ p, score: scorePlaylist(p, qNorm, qTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}
