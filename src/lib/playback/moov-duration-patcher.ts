// Pure MP4-box logic for the fragmented-MP4 duration fix (port of the iOS
// MoovDurationPatcher, proven root fix for the ~2x-duration bug).
//
// YouTube's audio-only m4a streams are *fragmented* MP4: the init `moov`
// declares the full track duration in `mvhd`/`mdhd`/`tkhd`, AND the `moof`
// fragments sum to the same duration, with no `mehd` to reconcile them.
// Fragment-aware demuxers (Safari's AVFoundation) ADD the header duration to
// the fragment sum, reporting ~2x the real length — the real audio ends and a
// silent second half plays. Header-only demuxers (Chrome/ffprobe) stay correct
// and recover duration from `sidx`/fragments when the header says 0.
//
// The fix: zero the duration fields in the init-`moov` headers so fragment-
// aware demuxers count only the fragments. This module finds those byte
// offsets and applies the zeroing to served chunks. It is pure (no I/O).
//
// Safety: offsets are returned ONLY when the file is fragmented (an `mvex`
// box is present), every duration box is version 0 with a non-zero duration,
// and the parse hit no anomaly — anything else yields [] and the stream is
// served byte-for-byte unchanged.

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "edts"]);
const MAX_DEPTH = 8;

/** Big-endian u32 at `offset`, or null if out of bounds. */
export function u32(b: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > b.length) return null;
  return (b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3];
}

function boxType(b: Uint8Array, offset: number): string | null {
  if (offset + 8 > b.length) return null;
  return String.fromCharCode(b[offset + 4], b[offset + 5], b[offset + 6], b[offset + 7]);
}

// Absolute offset of a ver0 full-box duration field, only if the box is
// version 0 and that duration is non-zero. `fieldOffset` is the duration
// field's position within the box body (16 for mvhd/mdhd, 20 for tkhd).
function ver0DurationOffset(
  b: Uint8Array,
  body: number,
  fieldOffset: number,
): number | null {
  if (body >= b.length || b[body] !== 0) return null; // version 0 only
  const off = body + fieldOffset;
  const value = u32(b, off);
  if (value === null || value === 0) return null;
  return off;
}

// Finds a top-level box by type, returning its body start and (clamped) end.
function topLevelBox(
  type: string,
  b: Uint8Array,
): { body: number; end: number } | null {
  let off = 0;
  while (off + 8 <= b.length) {
    const size0 = u32(b, off);
    const typ = boxType(b, off);
    if (size0 === null || typ === null) return null;
    if (typ === type) {
      const end = size0 > 1 ? Math.min(off + size0, b.length) : b.length;
      return { body: off + 8, end };
    }
    off += size0 > 1 ? size0 : 8;
  }
  return null;
}

// Byte offsets (absolute, within `head`) of the 4-byte duration field in the
// init `moov`'s `mvhd`, `mdhd`, and `tkhd` headers — returned ONLY when the
// file is fragmented (`mvex` present). Returns [] for non-fragmented files or
// on any parse anomaly (version-1 box, zero duration, truncation, garbage),
// so such streams are never altered.
export function durationFieldOffsets(head: Uint8Array): number[] {
  const moov = topLevelBox("moov", head);
  if (!moov) return [];

  const offsets: number[] = [];
  let sawMvex = false;
  let ok = true;

  function walk(start: number, end: number, depth: number): void {
    if (depth >= MAX_DEPTH) return;
    let off = start;
    while (ok && off + 8 <= end) {
      const size0 = u32(head, off);
      const typ = boxType(head, off);
      if (size0 === null || typ === null) {
        ok = false;
        return;
      }
      let hdr = 8;
      let size = size0;
      if (size0 === 1) {
        // 64-bit size: only the low 32 bits matter for our small head.
        const hi = u32(head, off + 8);
        const lo = u32(head, off + 12);
        if (hi !== 0 || lo === null) {
          ok = false;
          return;
        }
        size = lo;
        hdr = 16;
      } else if (size0 === 0) {
        size = end - off;
      }
      if (size < hdr) {
        ok = false;
        return;
      }
      const body = off + hdr;

      if (typ === "mvex") {
        sawMvex = true;
      } else if (typ === "mvhd" || typ === "mdhd") {
        const o = ver0DurationOffset(head, body, 16);
        if (o !== null) offsets.push(o);
        else ok = false;
      } else if (typ === "tkhd") {
        const o = ver0DurationOffset(head, body, 20);
        if (o !== null) offsets.push(o);
        else ok = false;
      } else if (CONTAINERS.has(typ)) {
        walk(body, Math.min(off + size, end), depth + 1);
      }
      off += size;
    }
  }

  walk(moov.body, moov.end, 0);
  if (!ok || !sawMvex || offsets.length === 0) return [];
  return offsets;
}

// If a top-level `moov` is present but its declared size runs past the fetched
// head, returns the absolute end offset so the caller can fetch exactly enough
// and re-parse; null otherwise.
export function moovEndIfTruncated(head: Uint8Array): number | null {
  let off = 0;
  while (off + 8 <= head.length) {
    const size = u32(head, off);
    if (size === null) return null;
    const typ = boxType(head, off);
    if (typ === "moov") {
      return size > 1 && off + size > head.length ? off + size : null;
    }
    off += size > 1 ? size : 8;
  }
  return null;
}

// Zeros the four-byte duration field at each absolute offset, but only where
// it intersects this chunk (`chunkAbsStart` = the chunk's absolute position in
// the file). Mutates and returns the same Uint8Array — size-preserving by
// construction. Handles a field that straddles a chunk or Range boundary.
export function applyPatchToChunk<T extends Uint8Array>(
  chunk: T,
  chunkAbsStart: number,
  offsets: number[],
): T {
  for (const fieldStart of offsets) {
    for (let k = 0; k < 4; k++) {
      const idx = fieldStart + k - chunkAbsStart;
      if (idx >= 0 && idx < chunk.length) chunk[idx] = 0;
    }
  }
  return chunk;
}
