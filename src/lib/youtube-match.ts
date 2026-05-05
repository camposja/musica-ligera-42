/**
 * Looser YouTube matching: score each candidate against the song's title +
 * artist instead of trusting YouTube's relevance ordering. Surfaces a match
 * type (exact/loose), a short reason tag, and a confidence score.
 *
 * Thresholds:
 *   ≥ EXACT_THRESHOLD (85) → "exact" match
 *   ≥ LOOSE_THRESHOLD (60) → "loose" match (with a reason tag if one fits)
 *   <  LOOSE_THRESHOLD     → no match (returns null)
 */

export const EXACT_THRESHOLD = 85;
export const LOOSE_THRESHOLD = 60;

export type Candidate = {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
};

export type ReasonTag =
  | "exact"
  | "live"
  | "lyric_video"
  | "official_audio"
  | "acoustic"
  | "remaster"
  | "remix"
  | "close";

export type MatchType = "exact" | "loose";

export type MatchResult = {
  best: string;
  alternates: string[];
  type: MatchType;
  reason: ReasonTag;
  score: number;
  title: string;
  channel: string;
};

export type SongMeta = {
  title: string;
  artist: string;
};

// --- text normalization ----------------------------------------------------

const NOISE_WORDS = new Set([
  "official", "video", "music", "audio", "hd", "4k", "lyrics",
  "lyric", "with", "feat", "ft", "featuring", "the",
  "a", "an", "at", "in", "on", "of", "to", "by", "for",
  "and", "or", "from", "as", "is",
]);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of normalize(s).split(" ")) {
    if (t.length > 0 && !NOISE_WORDS.has(t)) out.add(t);
  }
  return out;
}

// Coverage = fraction of song-title tokens that appear in the result tokens.
// Better than Jaccard for short titles ("Hello") that fully appear inside
// longer result strings ("Adele - Hello (Live at Royal Albert Hall)").
function coverage(songTitle: Set<string>, result: Set<string>): number {
  if (songTitle.size === 0) return 0;
  let inter = 0;
  for (const x of songTitle) if (result.has(x)) inter++;
  return inter / songTitle.size;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

const PENALIZED_REASONS: ReadonlySet<ReasonTag> = new Set<ReasonTag>([
  "live",
  "lyric_video",
  "acoustic",
  "remaster",
  "remix",
]);

// --- tag detection on raw lowercase result title ---------------------------

const HARD_REJECT_PATTERNS = [
  "karaoke",
  "instrumental",
  "reaction",
  "tutorial",
  "how to play",
  "8d audio",
  "slowed and reverb",
  "slowed + reverb",
  "nightcore",
];

const COVER_PATTERNS = [
  "cover by ",
  "guitar cover",
  "piano cover",
  "metal cover",
  "vocal cover",
  "drum cover",
  "acoustic cover",
];

function detectReason(rawTitle: string): ReasonTag | null {
  const lower = rawTitle.toLowerCase();
  // Wrap in spaces so we can look for word boundaries with " live " etc.
  const padded = ` ${lower} `;
  if (
    padded.includes(" live ") ||
    lower.includes("(live") ||
    lower.includes("[live") ||
    lower.includes("live at ") ||
    lower.includes("live in ") ||
    lower.includes("live from ")
  ) return "live";
  if (
    lower.includes("lyric video") ||
    lower.includes("(lyrics") ||
    lower.includes("[lyrics") ||
    lower.includes("with lyrics") ||
    lower.includes("lyrics)")
  ) return "lyric_video";
  if (lower.includes("official audio")) return "official_audio";
  if (lower.includes("acoustic") || lower.includes("unplugged")) return "acoustic";
  if (lower.includes("remaster")) return "remaster";
  if (lower.includes("remix")) return "remix";
  return null;
}

// --- scoring ----------------------------------------------------------------

export type ScoreResult = {
  score: number;
  reason: ReasonTag | null;
  rejected: boolean;
};

export function scoreCandidate(song: SongMeta, c: Candidate): ScoreResult {
  const lowerTitle = c.title.toLowerCase();

  // Hard rejects: candidate is essentially guaranteed not to be the song.
  for (const p of HARD_REJECT_PATTERNS) {
    if (lowerTitle.includes(p)) {
      return { score: 0, reason: null, rejected: true };
    }
  }

  const titleTokens = contentTokens(song.title);
  const artistTokens = contentTokens(song.artist);
  const resultTokens = contentTokens(c.title);
  const channelTokens = contentTokens(c.channel);

  let score = 30;

  // Title coverage (0..30): how much of the song title appears in the result.
  score += Math.round(coverage(titleTokens, resultTokens) * 30);

  // Artist signal — the strongest single confirmation that this is the song.
  const artistInTitle = intersects(artistTokens, resultTokens);
  const artistInChannel = intersects(artistTokens, channelTokens);
  if (artistInTitle) {
    score += 30;
  } else if (artistInChannel) {
    score += 30;
  }

  // Channel quality signal: VEVO and "- Topic" are official auto-uploads.
  const channelLower = c.channel.toLowerCase();
  if (channelLower.endsWith("vevo") || channelLower.endsWith(" - topic")) {
    score += 10;
  }

  // Duration sanity: too short = snippet/preview, too long = compilation/full
  // album. Real songs are mostly 1-8 min; allow up to 12 to cover prog rock.
  if (c.durationSec > 0) {
    if (c.durationSec < 30 || c.durationSec > 12 * 60) {
      score -= 20;
    }
  }

  // Single-word song titles ("Hello", "Yesterday") collide with all kinds of
  // unrelated videos. If we can't confirm the artist anywhere, refuse to
  // accept it as a match.
  if (
    titleTokens.size <= 1 &&
    !artistInTitle &&
    !artistInChannel
  ) {
    score -= 25;
  }

  // Soft penalty: cover by someone else (uses "by " or "-cover" patterns
  // to avoid catching legitimate songs like "Cover Me Up" or "Album Cover").
  // Cap at 50 so these can never qualify even as loose.
  for (const p of COVER_PATTERNS) {
    if (lowerTitle.includes(p)) {
      score = Math.min(score, 50);
      return { score, reason: null, rejected: false };
    }
  }

  const reason = detectReason(c.title);

  // Pushed-down penalty for non-canonical-recording reasons. A perfect
  // title+artist+channel match WITH "(Live)" should land in loose, not exact.
  // "official_audio" is NOT penalized — it is the canonical recording.
  if (reason && PENALIZED_REASONS.has(reason)) {
    score -= 25;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reason,
    rejected: false,
  };
}

// --- pick best match -------------------------------------------------------

type ScoredCandidate = Candidate & ScoreResult;

export function pickBestMatch(
  song: SongMeta,
  candidates: Candidate[],
): MatchResult | null {
  const scored: ScoredCandidate[] = candidates
    .map((c) => ({ ...c, ...scoreCandidate(song, c) }))
    .filter((c) => !c.rejected);

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const best = scored[0];
  if (best.score < LOOSE_THRESHOLD) return null;

  const type: MatchType = best.score >= EXACT_THRESHOLD ? "exact" : "loose";
  const reason: ReasonTag =
    type === "exact" ? "exact" : (best.reason ?? "close");

  return {
    best: best.id,
    alternates: scored.slice(1, 4).map((c) => c.id),
    type,
    reason,
    score: best.score,
    title: best.title,
    channel: best.channel,
  };
}
