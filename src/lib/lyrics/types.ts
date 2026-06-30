// Wire shape returned by GET /api/lyrics and consumed by the player UI. The
// `found` case carries the lyrics text; transport/parse details are never
// exposed (only a generic `error` string).
export type LyricsResponse =
  | { state: "found"; lyrics: string }
  | { state: "instrumental" }
  | { state: "not_found" }
  | { state: "error"; error: string };

// Internal provider/cache outcome. No error variant — the provider throws on
// transport failure and the service maps that to the `error` response state.
export type LyricsLookup =
  | { kind: "found"; lyrics: string }
  | { kind: "instrumental" }
  | { kind: "not_found" };
