// Lyrics-specific string normalization. Deliberately separate from the YouTube
// search/match normalizers (`youtube-search-cache.ts`, `youtube-match.ts`)
// because lyrics semantics differ: we want diacritic folding + artist/title
// keying, and must NOT drop YouTube "noise" words like "official"/"lyrics".

// Fold diacritics (é -> e), lowercase. Note: like the existing matcher, this
// folds accented Latin to ASCII but does not transliterate non-Latin scripts
// (Cyrillic, CJK, …) — acceptable for a best-effort lyrics lookup.
function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Cache key for a song: "<artist>|<title>", each side diacritic-folded,
// lowercased, and whitespace-collapsed. Punctuation is preserved (so "Track" and
// "Track (Live)" stay distinct), but accents are folded so "Beyoncé"/"Beyonce"
// share one cache row — a deliberate improvement over the iOS key.
export function lyricsKey(artist: string, title: string): string {
  const norm = (s: string) => fold(s).replace(/\s+/g, " ").trim();
  return `${norm(artist)}|${norm(title)}`;
}

// Comparison normalizer for matching LRCLIB search candidates against the
// request: diacritic-fold + lowercase + non-alphanumeric -> space + collapse.
export function lyricsMatchNorm(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Loose match: both non-empty and either exactly equal or a substring of the
// other (in either direction). Mirrors the iOS LRCLibProvider rule.
export function looselyMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
