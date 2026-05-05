export type ProviderName = "yt-dlp" | "piped";

export type PlaybackStream = {
  url: string;
  contentType: string;
  contentLength?: number;
  expiresAt: number;
  provider: ProviderName;
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
