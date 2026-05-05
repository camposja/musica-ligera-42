import { spawn } from "child_process";
import { ResolveError, type PlaybackProvider, type PlaybackStream } from "../types";

const CACHE_TTL_MS = 45 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const FORMAT = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio";

type YtDlpJson = {
  url?: string;
  ext?: string;
  acodec?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
};

type SpawnResult = { stdout: string; stderr: string };

// Spawn yt-dlp with a 10s timeout. On timeout: SIGTERM the child, clear the
// timer, drop all listeners — otherwise hung yt-dlp processes leak.
function ytDlp(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
      cleanup();
      reject(new Error(`yt-dlp timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
    }

    child.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.trim().slice(0, 500)}`));
      }
    });
  });
}

function mimeFromExt(ext?: string): string {
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "webm" || ext === "opus") return "audio/webm";
  return "audio/mp4";
}

export const ytDlpProvider: PlaybackProvider = {
  name: "yt-dlp",
  async resolve(videoId: string): Promise<PlaybackStream> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    let result: SpawnResult;
    try {
      result = await ytDlp([
        "-f", FORMAT,
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        url,
      ]);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        console.error("[playback/yt-dlp] binary not found on PATH");
        throw new ResolveError(
          "yt_dlp_missing",
          "yt-dlp binary not found on PATH (try `brew install yt-dlp`)",
          err,
        );
      }
      const message = (err as Error).message;
      console.error("[playback/yt-dlp] extract failed", { videoId, message });
      throw new ResolveError("extract_failed", message, err);
    }

    let json: YtDlpJson;
    try {
      json = JSON.parse(result.stdout) as YtDlpJson;
    } catch (err) {
      throw new ResolveError(
        "extract_failed",
        "yt-dlp returned non-JSON stdout",
        err,
      );
    }

    if (!json.url) {
      throw new ResolveError("extract_failed", "yt-dlp result has no url field");
    }

    return {
      url: json.url,
      contentType: mimeFromExt(json.ext),
      contentLength: json.filesize ?? json.filesize_approx ?? undefined,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  },
};
