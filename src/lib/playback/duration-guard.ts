// Client safety net for the fragmented-MP4 duration bug: when the browser's
// parsed duration wildly exceeds the authoritative YouTube duration, the
// stream is a duration misread (real audio ends at the authoritative mark and
// only silence follows), so playback should end there instead of crawling
// through the silent tail. The server-side moov patch is the primary fix —
// this guard only catches streams the patch couldn't fix (probe failure, kill
// switch, unexpected container variants).

// Browser duration must exceed authoritative by this factor before we trust
// the authoritative value over the browser (the misread is ~2x in practice).
export const DURATION_MISMATCH_RATIO = 1.7;
// Ignore implausibly short authoritative durations (bad metadata, live).
export const MIN_AUTHORITATIVE_SEC = 30;
// Let playback run slightly past the authoritative end before forcing the
// advance, so a legitimate outro is never clipped by a second or two of drift.
export const END_GRACE_SEC = 1.5;

export function shouldForceEnd(input: {
  authoritativeSec: number | null | undefined;
  browserDurationSec: number;
  currentTimeSec: number;
}): boolean {
  const { authoritativeSec, browserDurationSec, currentTimeSec } = input;
  if (!authoritativeSec || authoritativeSec < MIN_AUTHORITATIVE_SEC) return false;
  if (!Number.isFinite(browserDurationSec) || browserDurationSec <= 0) return false;
  if (browserDurationSec <= DURATION_MISMATCH_RATIO * authoritativeSec) return false;
  return currentTimeSec >= authoritativeSec + END_GRACE_SEC;
}
