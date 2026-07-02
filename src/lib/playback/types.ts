export type ProviderName = "yt-dlp" | "piped";

// Result of probing a stream's init moov for the fragmented-MP4 duration fix.
// "offsets" = zero these absolute byte offsets when serving; "none" = probed
// and decided never to patch (not fragmented / not mp4 / probe failed / env
// kill switch). Cached on the stream entry for its TTL so we probe once.
export type MoovPatchState =
  | { state: "offsets"; offsets: number[] }
  | { state: "none" };

export type PlaybackStream = {
  url: string;
  contentType: string;
  contentLength?: number;
  // Authoritative duration in seconds when the provider reports one (yt-dlp
  // --dump-json `duration`); used to self-heal Song.youtubeDurationSeconds.
  durationSeconds?: number;
  expiresAt: number;
  provider: ProviderName;
  moovPatch?: MoovPatchState;
  moovPatchPromise?: Promise<MoovPatchState>;
};

export type ResolveErrorCode =
  | "yt_dlp_missing"
  | "extract_failed"
  | "stream_403"
  | "upstream_failed"
  | "invalid_video_id"
  | "all_providers_failed";

export class ResolveError extends Error {
  constructor(
    public readonly code: ResolveErrorCode,
    public readonly detail: string,
    public readonly cause?: unknown,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ResolveError";
  }
}

export type PlaybackProvider = {
  readonly name: ProviderName;
  resolve(videoId: string): Promise<PlaybackStream>;
};
