import { describe, expect, it } from "vitest";
import {
  applyPatchToChunk,
  durationFieldOffsets,
  moovEndIfTruncated,
  u32,
} from "@/lib/playback/moov-duration-patcher";

// --- fixture builders (ported from the iOS MoovDurationPatcherTests) --------

function be32(v: number): number[] {
  return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function box(type: string, body: number[]): number[] {
  return [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
}

const NON_ZERO_DURATION = [0x00, 0xbf, 0x6e, 0x20]; // 12545568
const ZERO4 = [0, 0, 0, 0];

// mvhd ver0 body: verflags(4) creation(4) modification(4) timescale(4) duration(4) → dur @ body+16
function mvhd(opts: { version?: number; duration?: number[] } = {}): number[] {
  const verflags = [opts.version ?? 0, 0, 0, 0];
  return box("mvhd", [
    ...verflags,
    ...ZERO4,
    ...ZERO4,
    ...be32(44100),
    ...(opts.duration ?? NON_ZERO_DURATION),
  ]);
}

// tkhd ver0 body: verflags(4) creation(4) modification(4) trackID(4) reserved(4) duration(4) → dur @ body+20
function tkhd(): number[] {
  return box("tkhd", [
    ...ZERO4,
    ...ZERO4,
    ...ZERO4,
    ...be32(1),
    ...ZERO4,
    ...NON_ZERO_DURATION,
  ]);
}

// mdhd ver0 body: same duration position as mvhd (body+16)
function mdhd(): number[] {
  return box("mdhd", [
    ...ZERO4,
    ...ZERO4,
    ...ZERO4,
    ...be32(44100),
    ...NON_ZERO_DURATION,
  ]);
}

function elst(): number[] {
  return box("elst", [...ZERO4, ...be32(1), ...NON_ZERO_DURATION, ...be32(1600), ...be32(1)]);
}

function mvex(): number[] {
  return box("mvex", []);
}

// ftyp(16) + moov{ mvhd, [mvex], trak{ tkhd, edts{elst}, mdia{mdhd} } }
function buildHeader(opts: {
  fragmented: boolean;
  mvhdVersion?: number;
  mvhdDuration?: number[];
}): Uint8Array {
  const ftyp = box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0)), ...ZERO4]);
  const trak = box("trak", [...tkhd(), ...box("edts", elst()), ...box("mdia", mdhd())]);
  const moovBody = [
    ...mvhd({ version: opts.mvhdVersion, duration: opts.mvhdDuration }),
    ...(opts.fragmented ? mvex() : []),
    ...trak,
  ];
  return new Uint8Array([...ftyp, ...box("moov", moovBody)]);
}

// --- offset discovery ---------------------------------------------------------

describe("durationFieldOffsets", () => {
  it("finds the three duration offsets in a fragmented header", () => {
    const head = buildHeader({ fragmented: true });
    // ftyp=16. moov body @24. mvhd@24 (dur@48). mvex@52. trak@60.
    // tkhd@68 (dur@96). edts@100. mdia@136. mdhd@144 (dur@168).
    expect(durationFieldOffsets(head)).toEqual([48, 96, 168]);
    for (const off of [48, 96, 168]) {
      expect(u32(head, off)).toBe(12_545_568);
    }
  });

  it("returns [] for a non-fragmented header (no mvex)", () => {
    // Identical tree WITHOUT mvex → must not patch (could corrupt a normal
    // progressive file).
    const head = buildHeader({ fragmented: false });
    expect(durationFieldOffsets(head)).toEqual([]);
  });

  it("returns [] when a duration box is version 1 (all-or-nothing)", () => {
    const head = buildHeader({ fragmented: true, mvhdVersion: 1 });
    expect(durationFieldOffsets(head)).toEqual([]);
  });

  it("returns [] when a duration is already zero", () => {
    const head = buildHeader({ fragmented: true, mvhdDuration: ZERO4 });
    expect(durationFieldOffsets(head)).toEqual([]);
  });

  it("returns [] for garbage and empty input", () => {
    expect(durationFieldOffsets(new Uint8Array(64))).toEqual([]);
    expect(durationFieldOffsets(new Uint8Array(0))).toEqual([]);
  });

  it("returns [] when truncation cuts into a duration field (parse anomaly)", () => {
    // Cut mid-mvhd so the duration u32 read at 48 runs out of bounds.
    const head = buildHeader({ fragmented: true });
    expect(durationFieldOffsets(head.slice(0, 50))).toEqual([]);
  });
});

// --- moovEndIfTruncated -------------------------------------------------------

describe("moovEndIfTruncated", () => {
  it("returns the declared end when moov runs past the buffer", () => {
    const head = buildHeader({ fragmented: true });
    const moovStart = 16; // after ftyp
    const moovSize = u32(head, moovStart)!;
    const truncated = head.slice(0, moovStart + 20);
    expect(moovEndIfTruncated(truncated)).toBe(moovStart + moovSize);
  });

  it("returns null for a complete moov", () => {
    expect(moovEndIfTruncated(buildHeader({ fragmented: true }))).toBeNull();
  });

  it("returns null when there is no moov", () => {
    expect(moovEndIfTruncated(new Uint8Array(32))).toBeNull();
  });
});

// --- patching -------------------------------------------------------------------

describe("applyPatchToChunk", () => {
  it("zeros exactly the duration fields, neighbours untouched", () => {
    const head = buildHeader({ fragmented: true });
    const offsets = durationFieldOffsets(head);
    applyPatchToChunk(head, 0, offsets);
    for (const off of offsets) {
      expect(u32(head, off)).toBe(0);
    }
    // A neighbouring field (mvhd timescale @ body(32)+12) must be untouched.
    expect(u32(head, 44)).toBe(44100);
  });

  it("handles a field split across a chunk boundary", () => {
    // Serve only bytes [48,50): the first two bytes of the mvhd duration @48.
    const slice = new Uint8Array([0xbf, 0x77]);
    applyPatchToChunk(slice, 48, [48, 96, 168]);
    expect([...slice]).toEqual([0, 0]);
  });

  it("is a no-op outside the patched region", () => {
    const slice = new Uint8Array([1, 2, 3, 4]);
    applyPatchToChunk(slice, 1000, [48, 96, 168]);
    expect([...slice]).toEqual([1, 2, 3, 4]);
  });
});
