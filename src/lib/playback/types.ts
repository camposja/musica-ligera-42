export type PlaybackStream = {
  url: string;
  contentType: string;
  contentLength?: number;
  expiresAt: number;
};

export type ResolveErrorCode =
  | "yt_dlp_missing"
  | "extract_failed"
  | "stream_403"
  | "upstream_failed"
  | "invalid_video_id";

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
  readonly name: string;
  resolve(videoId: string): Promise<PlaybackStream>;
};
