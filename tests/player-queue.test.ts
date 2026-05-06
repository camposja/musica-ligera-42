import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampIndex,
  getNextPlayableYoutubeId,
  nextIndex,
  previousIndex,
  shuffleKeepingCurrent,
  unshuffleKeepingCurrent,
} from "@/lib/player-queue";

type S = { id: string };
const songs = (...ids: string[]): S[] => ids.map((id) => ({ id }));

// === clampIndex ============================================================

describe("clampIndex", () => {
  it("returns null for empty queue", () => {
    expect(clampIndex(0, 0)).toBeNull();
    expect(clampIndex(5, 0)).toBeNull();
  });

  it("clamps negative to 0", () => {
    expect(clampIndex(-3, 5)).toBe(0);
  });

  it("clamps >= length to length-1", () => {
    expect(clampIndex(99, 5)).toBe(4);
    expect(clampIndex(5, 5)).toBe(4);
  });

  it("returns idx unchanged when in range", () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(0, 5)).toBe(0);
    expect(clampIndex(4, 5)).toBe(4);
  });
});

// === nextIndex / previousIndex ============================================

describe("nextIndex", () => {
  it("advances by 1", () => {
    expect(nextIndex(5, 2)).toBe(3);
  });

  it("returns null at end", () => {
    expect(nextIndex(5, 4)).toBeNull();
  });

  it("returns null on empty queue", () => {
    expect(nextIndex(0, 0)).toBeNull();
  });

  it("returns null on negative current", () => {
    expect(nextIndex(5, -1)).toBeNull();
  });
});

describe("previousIndex", () => {
  it("goes back by 1", () => {
    expect(previousIndex(5, 2)).toBe(1);
  });

  it("returns null at start", () => {
    expect(previousIndex(5, 0)).toBeNull();
  });

  it("returns null on empty queue", () => {
    expect(previousIndex(0, 0)).toBeNull();
  });
});

// === shuffleKeepingCurrent ================================================

describe("shuffleKeepingCurrent", () => {
  beforeEach(() => {
    // Deterministic shuffle for the few tests that care about exact order.
    let seed = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      seed += 1;
      return (seed * 0.13) % 1; // pseudo-deterministic
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places current song at index 0", () => {
    const q = songs("a", "b", "c", "d", "e");
    const r = shuffleKeepingCurrent(q, 2);
    expect(r.currentIndex).toBe(0);
    expect(r.queue[0]).toEqual({ id: "c" });
  });

  it("includes every original song exactly once", () => {
    const q = songs("a", "b", "c", "d", "e", "f", "g");
    const r = shuffleKeepingCurrent(q, 3);
    expect(r.queue.map((s) => s.id).sort()).toEqual(
      ["a", "b", "c", "d", "e", "f", "g"].sort(),
    );
  });

  it("single-element queue is unchanged", () => {
    const q = songs("only");
    const r = shuffleKeepingCurrent(q, 0);
    expect(r.queue).toEqual([{ id: "only" }]);
    expect(r.currentIndex).toBe(0);
  });

  it("does not mutate the input queue", () => {
    const q = songs("a", "b", "c", "d");
    const original = q.slice();
    shuffleKeepingCurrent(q, 1);
    expect(q).toEqual(original);
  });
});

// === unshuffleKeepingCurrent ==============================================

describe("unshuffleKeepingCurrent", () => {
  it("restores the original order", () => {
    const original = songs("a", "b", "c", "d");
    const r = unshuffleKeepingCurrent(original, "c");
    expect(r.queue).toEqual(original);
    expect(r.currentIndex).toBe(2);
  });

  it("locates currentSongId at the start of the original", () => {
    const original = songs("a", "b", "c", "d");
    expect(unshuffleKeepingCurrent(original, "a").currentIndex).toBe(0);
  });

  it("falls back to index 0 when current isn't in the original", () => {
    const original = songs("a", "b", "c");
    const r = unshuffleKeepingCurrent(original, "missing");
    expect(r.currentIndex).toBe(0);
  });

  it("does not return the same array reference (caller can mutate safely)", () => {
    const original = songs("a", "b", "c");
    const r = unshuffleKeepingCurrent(original, "b");
    expect(r.queue).not.toBe(original);
  });
});

// === getNextPlayableYoutubeId =============================================

describe("getNextPlayableYoutubeId", () => {
  const VALID_A = "dQw4w9WgXcQ";
  const VALID_B = "Y-cVOswhJUU";

  it("returns the next song's youtubeId when valid", () => {
    const queue = [
      { id: "1", youtubeId: VALID_A },
      { id: "2", youtubeId: VALID_B },
    ];
    expect(getNextPlayableYoutubeId(queue, 0)).toBe(VALID_B);
  });

  it("returns null at the end of the queue", () => {
    const queue = [
      { id: "1", youtubeId: VALID_A },
      { id: "2", youtubeId: VALID_B },
    ];
    expect(getNextPlayableYoutubeId(queue, 1)).toBeNull();
  });

  it("returns null when the next song has youtubeId: null", () => {
    const queue = [
      { id: "1", youtubeId: VALID_A },
      { id: "2", youtubeId: null },
    ];
    expect(getNextPlayableYoutubeId(queue, 0)).toBeNull();
  });

  it("returns null when the next song's youtubeId fails the 11-char regex", () => {
    const queue = [
      { id: "1", youtubeId: VALID_A },
      { id: "2", youtubeId: "tooShort" },
    ];
    expect(getNextPlayableYoutubeId(queue, 0)).toBeNull();
  });

  it("after shuffle, returns the shuffled-next youtubeId", () => {
    const original = [
      { id: "1", youtubeId: VALID_A },
      { id: "2", youtubeId: VALID_B },
      { id: "3", youtubeId: "AAAAAAAAAAA" },
    ];
    const r = shuffleKeepingCurrent(original, 0);
    // After shuffle, current is at index 0; next is whatever ended up at 1.
    const expected = r.queue[1].youtubeId;
    expect(getNextPlayableYoutubeId(r.queue, 0)).toBe(expected);
  });

  it("works with empty queue / negative index", () => {
    expect(getNextPlayableYoutubeId([], 0)).toBeNull();
    expect(
      getNextPlayableYoutubeId([{ id: "1", youtubeId: VALID_A }], -1),
    ).toBe(VALID_A);
  });
});
