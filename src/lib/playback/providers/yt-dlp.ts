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
  duration?: number | null;
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
        reject(
          new Error(`yt-dlp exited ${code}: ${redactUrls(stderr).trim().slice(0, 500)}`),
        );
      }
    });
  });
}

// Resolved googlevideo URLs carry signed `pot`/`sig` query parameters. yt-dlp
// echoes URLs into stderr on some errors, and stderr is logged now — so strip
// anything URL-shaped before it can reach the logs.
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "[url]");
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
        "--no-progress",
        // yt-dlp only auto-enables Deno. Without a JS runtime it can't solve
        // YouTube's nsig challenge, and the formats it does return are
        // token-restricted (~1 MiB of each file, then 403). Node is on PATH in
        // the container (node:22 base) and on typical dev machines.
        "--js-runtimes", "node",
        // Keeps the "your version is older than 90 days" banner out of the
        // stderr we now log, so what remains is signal.
        "--no-update",
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
      const message = redactUrls((err as Error).message);
      console.error("[playback/yt-dlp] extract failed", { videoId, message });
      throw new ResolveError("extract_failed", message, err);
    }

    // Exited 0 but wrote to stderr — almost always a deprecation notice or a
    // "some formats may be missing" warning. Swallowing these (via the
    // `--no-warnings` that used to live above) is what let an extractor break
    // run silently for months. Truncated and URL-redacted.
    const stderr = redactUrls(result.stderr).trim();
    if (stderr) {
      console.warn("[playback/yt-dlp] stderr", {
        videoId,
        stderr: stderr.slice(0, 500),
      });
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
      durationSeconds:
        typeof json.duration === "number" && json.duration > 0
          ? Math.round(json.duration)
          : undefined,
      expiresAt: Date.now() + CACHE_TTL_MS,
      provider: "yt-dlp",
    };
  },
};
