import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process.spawn BEFORE importing anything that touches it.
const spawnMock = vi.fn();
vi.mock("child_process", () => ({
  spawn: (cmd: string, args: string[]) => spawnMock(cmd, args),
}));

import { clearCookies, ctx, setUserSession, prisma, truncateAll } from "./helpers";
import {
  _resetCacheForTests,
  resolveAudio,
  evictAudioCache,
  resetPlaybackProvidersForTests,
} from "@/lib/playback/resolver";
import { ResolveError } from "@/lib/playback/types";
import { GET as audioGET } from "@/app/api/youtube/audio/[videoId]/route";
import { GET as audioStatusGET } from "@/app/api/youtube/audio-status/[videoId]/route";

const VID = "dQw4w9WgXcQ";
const ORIGINAL_PIPED = process.env.PIPED_API_BASE_URL;

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  _resetCacheForTests();
  spawnMock.mockReset();
  // Default: Piped fallback disabled. Individual tests opt in.
  delete process.env.PIPED_API_BASE_URL;
  resetPlaybackProvidersForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_PIPED === undefined) {
    delete process.env.PIPED_API_BASE_URL;
  } else {
    process.env.PIPED_API_BASE_URL = ORIGINAL_PIPED;
  }
  resetPlaybackProvidersForTests();
});

// --- spawn fake helper ------------------------------------------------------

type FakeChildOpts = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  spawnError?: NodeJS.ErrnoException;
};

// Schedule events to fire AFTER the provider attaches listeners. We schedule
// from inside the mocked spawn() (via mockImplementationOnce) rather than at
// test-setup time so the events don't fire before the provider's .on() calls
// have run.
function mockSpawnOnce(opts: FakeChildOpts) {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();

    setImmediate(() => {
      if (opts.spawnError) {
        child.emit("error", opts.spawnError);
        return;
      }
      if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
      if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
      child.emit("close", opts.exitCode ?? 0);
    });

    return child;
  });
}

function ytDlpJson(
  opts: { url?: string; ext?: string; filesize?: number; duration?: number } = {},
) {
  return JSON.stringify({
    url: opts.url ?? "https://cdn.example/audio.m4a",
    ext: opts.ext ?? "m4a",
    filesize: opts.filesize ?? 1234567,
    duration: opts.duration,
    acodec: "mp4a.40.2",
  });
}

function enoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
}

async function makeUserSession() {
  const u = await prisma.user.create({
    data: { name: "alice", role: "USER", accessCode: "x" },
  });
  await setUserSession(u.id);
}

// === resolveAudio ==========================================================

describe("resolveAudio", () => {
  it("returns a PlaybackStream from yt-dlp JSON", async () => {
    mockSpawnOnce({
      stdout: ytDlpJson({ url: "https://cdn/x.m4a", ext: "m4a", filesize: 4242 }),
    });
    const stream = await resolveAudio(VID);
    expect(stream.url).toBe("https://cdn/x.m4a");
    expect(stream.contentType).toBe("audio/mp4");
    expect(stream.contentLength).toBe(4242);
    expect(stream.expiresAt).toBeGreaterThan(Date.now());
    expect(stream.provider).toBe("yt-dlp");
  });

  // Regression guard for the Aug 2026 outage: the pinned yt-dlp had no JS
  // runtime, so it handed out token-restricted URLs that 403'd past ~1 MiB,
  // and `--no-warnings` hid the deprecation notice that said so.
  it("spawns yt-dlp with a JS runtime and without --no-warnings", async () => {
    mockSpawnOnce({ stdout: ytDlpJson() });
    await resolveAudio(VID);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain("--js-runtimes");
    expect(args[args.indexOf("--js-runtimes") + 1]).toBe("node");
    expect(args).toContain("--no-update");
    expect(args).not.toContain("--no-warnings");
  });

  it("logs stderr when yt-dlp exits 0 with warnings, and still resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSpawnOnce({
      stdout: ytDlpJson(),
      stderr: "WARNING: [youtube] some formats may be missing",
      exitCode: 0,
    });
    const stream = await resolveAudio(VID);
    expect(stream.provider).toBe("yt-dlp");
    expect(warn).toHaveBeenCalledWith(
      "[playback/yt-dlp] stderr",
      expect.objectContaining({
        videoId: VID,
        stderr: expect.stringContaining("some formats may be missing"),
      }),
    );
    warn.mockRestore();
  });

  it("redacts signed URLs out of logged stderr", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSpawnOnce({
      stdout: ytDlpJson(),
      stderr: "WARNING: failed on https://rr4---sn-abc.googlevideo.com/v?pot=SECRET&sig=SHH",
      exitCode: 0,
    });
    await resolveAudio(VID);
    const logged = (warn.mock.calls[0][1] as { stderr: string }).stderr;
    expect(logged).not.toContain("SECRET");
    expect(logged).not.toContain("googlevideo.com");
    expect(logged).toContain("[url]");
    warn.mockRestore();
  });

  it("maps webm/opus ext to audio/webm content type", async () => {
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "webm" }) });
    const stream = await resolveAudio(VID);
    expect(stream.contentType).toBe("audio/webm");
  });

  it("throws ResolveError(yt_dlp_missing) on ENOENT", async () => {
    mockSpawnOnce({ spawnError: enoentError() });
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      name: "ResolveError",
      code: "yt_dlp_missing",
    });
  });

  it("throws ResolveError(extract_failed) on non-zero exit", async () => {
    mockSpawnOnce({ exitCode: 1, stderr: "ERROR: Video unavailable" });
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      name: "ResolveError",
      code: "extract_failed",
    });
  });

  it("throws ResolveError on non-JSON stdout", async () => {
    mockSpawnOnce({ stdout: "not json at all" });
    await expect(resolveAudio(VID)).rejects.toBeInstanceOf(ResolveError);
  });

  it("throws ResolveError(extract_failed) when JSON has no url field", async () => {
    mockSpawnOnce({ stdout: JSON.stringify({ ext: "m4a" }) });
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      code: "extract_failed",
    });
  });

  it("caches results — second call doesn't spawn yt-dlp", async () => {
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/once" }) });
    const a = await resolveAudio(VID);
    const b = await resolveAudio(VID);
    expect(a.url).toBe("https://cdn/once");
    expect(b.url).toBe("https://cdn/once");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("evictAudioCache forces a re-resolve", async () => {
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/first" }) });
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/second" }) });
    const a = await resolveAudio(VID);
    expect(a.url).toBe("https://cdn/first");
    evictAudioCache(VID);
    const b = await resolveAudio(VID);
    expect(b.url).toBe("https://cdn/second");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

// === GET /api/youtube/audio-status =========================================

function statusReq(videoId: string): Request {
  return new Request(`http://x/api/youtube/audio-status/${videoId}`);
}

describe("GET /api/youtube/audio-status/[videoId]", () => {
  it("401 without session", async () => {
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(401);
  });

  it("400 on malformed videoId", async () => {
    await makeUserSession();
    const res = await audioStatusGET(
      statusReq("bad"),
      ctx({ videoId: "bad" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "invalid_video_id" });
  });

  it("ok:true with contentType + contentLength + provider on success", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a", filesize: 42 }) });
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      contentType: "audio/mp4",
      contentLength: 42,
      provider: "yt-dlp",
    });
  });

  it("returns durationSeconds and self-heals the Song row", async () => {
    await makeUserSession();
    const song = await prisma.song.create({
      data: { title: "T", artist: "A", youtubeId: VID },
    });
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a", duration: 213 }) });
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.durationSeconds).toBe(213);
    const updated = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(updated.youtubeDurationSeconds).toBe(213);
  });

  it("durationSeconds is null when the resolver reports none; no DB write", async () => {
    await makeUserSession();
    const song = await prisma.song.create({
      data: { title: "T", artist: "A", youtubeId: VID, youtubeDurationSeconds: 99 },
    });
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) }); // no duration field
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    const body = await res.json();
    expect(body.durationSeconds).toBeNull();
    const updated = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(updated.youtubeDurationSeconds).toBe(99); // untouched
  });

  it("a failed self-heal write does not fail the status response", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a", duration: 213 }) });
    vi.spyOn(prisma.song, "updateMany").mockRejectedValueOnce(new Error("db down"));
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, durationSeconds: 213 });
  });

  it("ok:false code:yt_dlp_missing when binary missing", async () => {
    await makeUserSession();
    mockSpawnOnce({ spawnError: enoentError() });
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "yt_dlp_missing" });
  });

  it("ok:false code:extract_failed on yt-dlp non-zero exit", async () => {
    await makeUserSession();
    mockSpawnOnce({ exitCode: 1, stderr: "Video unavailable" });
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "extract_failed" });
  });
});

// === GET /api/youtube/audio ================================================

function audioReq(videoId: string, init: RequestInit = {}): Request {
  return new Request(`http://x/api/youtube/audio/${videoId}`, init);
}

describe("GET /api/youtube/audio/[videoId]", () => {
  it("401 without session", async () => {
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(401);
  });

  it("400 on malformed videoId", async () => {
    await makeUserSession();
    const res = await audioGET(audioReq("bad"), ctx({ videoId: "bad" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_video_id" });
  });

  it("happy path: 200, forwards content-type, streams body", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/x.m4a" }) });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("AUDIO_BYTES", {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "11" },
      }),
    );
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("AUDIO_BYTES");
  });

  it("forwards Range header upstream and returns 206 + Content-Range", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson() });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("PARTIAL", {
        status: 206,
        headers: {
          "content-type": "audio/mp4",
          "content-range": "bytes 100-199/2000",
          "content-length": "100",
        },
      }),
    );
    const res = await audioGET(
      audioReq(VID, { headers: { range: "bytes=100-199" } }),
      ctx({ videoId: VID }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/2000");
    const sentHeaders = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(sentHeaders.get("range")).toBe("bytes=100-199");
  });

  it("on upstream 403, evicts cache, re-resolves, retries — succeeds", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/stale" }) });
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/fresh" }) });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response("RECOVERED", {
          status: 200,
          headers: { "content-type": "audio/mp4" },
        }),
      );
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("RECOVERED");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("on upstream 403 + retry still 403 → 502 stream_403", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson() });
    mockSpawnOnce({ stdout: ytDlpJson() });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const res = await audioGET(
      audioReq(VID, { headers: { range: "bytes=0-" } }),
      ctx({ videoId: VID }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "stream_403" });
    // The range context is what makes the 1 MiB-ceiling failure legible in logs.
    expect(body.detail).toContain("range=bytes=0-");
    expect(body.detail).toContain("content-range=none");
  });

  it("502 yt_dlp_missing when binary not on PATH", async () => {
    await makeUserSession();
    mockSpawnOnce({ spawnError: enoentError() });
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "yt_dlp_missing" });
  });

  it("502 extract_failed when yt-dlp exits non-zero", async () => {
    await makeUserSession();
    mockSpawnOnce({ exitCode: 1, stderr: "Video unavailable" });
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "extract_failed" });
  });

  it("502 upstream_failed when CDN returns non-403 4xx/5xx", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("server error", { status: 500 }),
    );
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "upstream_failed" });
  });
});

// === fragmented-MP4 moov duration patch ====================================

// Minimal synthetic fragmented-MP4 head (same shape as the real YouTube init
// segment): ftyp + moov{mvhd, mvex, trak{tkhd, mdia{mdhd}}}. Duration fields
// land at absolute offsets 48 (mvhd), 96 (tkhd), 132 (mdhd).
function be32(v: number): number[] {
  return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
function mp4box(type: string, body: number[]): number[] {
  return [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
}
const DURATION_BE = [0x00, 0xbf, 0x6e, 0x20]; // 12545568
function fragmentedHead(): Uint8Array {
  const Z = [0, 0, 0, 0];
  const mvhd = mp4box("mvhd", [...Z, ...Z, ...Z, ...be32(44100), ...DURATION_BE]);
  const tkhd = mp4box("tkhd", [...Z, ...Z, ...Z, ...be32(1), ...Z, ...DURATION_BE]);
  const mdhd = mp4box("mdhd", [...Z, ...Z, ...Z, ...be32(44100), ...DURATION_BE]);
  const trak = mp4box("trak", [...tkhd, ...mp4box("mdia", mdhd)]);
  const moov = mp4box("moov", [...mvhd, ...mp4box("mvex", []), ...trak]);
  const ftyp = mp4box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0)), ...Z]);
  return new Uint8Array([...ftyp, ...moov]);
}
const HEAD = fragmentedHead();
const HEAD_OFFSETS = [48, 96, 132];

function upstreamResponse(
  bytes: Uint8Array,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(new Uint8Array(bytes), {
    status: init.status ?? 200,
    headers: {
      "content-type": "audio/mp4",
      "content-length": String(bytes.length),
      ...init.headers,
    },
  });
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

describe("GET /api/youtube/audio — moov duration patch", () => {
  const ORIGINAL_DISABLE = process.env.DISABLE_MOOV_DURATION_PATCH;

  afterEach(() => {
    if (ORIGINAL_DISABLE === undefined) {
      delete process.env.DISABLE_MOOV_DURATION_PATCH;
    } else {
      process.env.DISABLE_MOOV_DURATION_PATCH = ORIGINAL_DISABLE;
    }
  });

  it("zeroes the duration fields end-to-end; other bytes and headers intact", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD)) // main request
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 })); // head probe
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.length).toBe(HEAD.length);
    expect(res.headers.get("content-length")).toBe(String(HEAD.length));
    for (const off of HEAD_OFFSETS) {
      expect(readU32(HEAD, off)).toBe(12_545_568); // fixture sanity
      expect(readU32(got, off)).toBe(0);
    }
    // Every byte outside the three 4-byte fields is untouched.
    const patched = new Set(HEAD_OFFSETS.flatMap((o) => [o, o + 1, o + 2, o + 3]));
    for (let i = 0; i < HEAD.length; i++) {
      if (!patched.has(i)) expect(got[i]).toBe(HEAD[i]);
    }
  });

  it("drops last-modified when patched (body is no longer byte-identical)", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    const lm = "Wed, 01 Jul 2026 00:00:00 GMT";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD, { headers: { "last-modified": lm } }))
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 }));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.headers.get("last-modified")).toBeNull();
  });

  it("keeps last-modified when the stream is not patched (no mvex)", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    const plain = new Uint8Array(64); // garbage → parse yields no offsets
    const lm = "Wed, 01 Jul 2026 00:00:00 GMT";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(plain, { headers: { "last-modified": lm } }))
      .mockResolvedValueOnce(upstreamResponse(plain, { status: 206 }));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.headers.get("last-modified")).toBe(lm);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(plain);
  });

  it("patches only in-range bytes on a ranged request straddling a field", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    // First request warms the probe (offsets cached on the stream entry).
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD))
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 }))
      // Ranged request: bytes 50-99 — covers the tail of the mvhd field (48-51)
      // and all of the tkhd field (96-99).
      .mockResolvedValueOnce(
        upstreamResponse(HEAD.slice(50, 100), {
          status: 206,
          headers: { "content-range": `bytes 50-99/${HEAD.length}` },
        }),
      );
    await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const res = await audioGET(
      audioReq(VID, { headers: { range: "bytes=50-99" } }),
      ctx({ videoId: VID }),
    );
    expect(res.status).toBe(206);
    const got = new Uint8Array(await res.arrayBuffer());
    const expected = HEAD.slice(50, 100);
    for (const off of HEAD_OFFSETS) {
      for (let k = 0; k < 4; k++) {
        const idx = off + k - 50;
        if (idx >= 0 && idx < expected.length) expected[idx] = 0;
      }
    }
    expect(got).toEqual(expected);
    // Sanity: in-range bytes of the mvhd field (50,51) zeroed; the tkhd field too.
    expect(got[0]).toBe(0); // abs 50 (mvhd duration byte 3)
    expect(got[46]).toBe(0); // abs 96 (tkhd duration byte 0)
  });

  it("passes a range entirely past the moov through untouched", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    const tail = new Uint8Array([9, 8, 7, 6]);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD))
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 }))
      .mockResolvedValueOnce(
        upstreamResponse(tail, {
          status: 206,
          headers: { "content-range": "bytes 1000-1003/2000" },
        }),
      );
    await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const res = await audioGET(
      audioReq(VID, { headers: { range: "bytes=1000-1003" } }),
      ctx({ videoId: VID }),
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tail);
  });

  it("never probes webm streams (fetch called once)", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "webm" }) });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("WEBM_BYTES", {
          status: 200,
          headers: { "content-type": "audio/webm" },
        }),
      );
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(await res.text()).toBe("WEBM_BYTES");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("probes parameterized mp4 content types (audio/mp4; codecs=…)", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        upstreamResponse(HEAD, {
          headers: { "content-type": 'audio/mp4; codecs="mp4a.40.2"' },
        }),
      )
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 }));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const got = new Uint8Array(await res.arrayBuffer());
    expect(readU32(got, 48)).toBe(0);
  });

  it("DISABLE_MOOV_DURATION_PATCH=1 → no probe, body unmodified", async () => {
    process.env.DISABLE_MOOV_DURATION_PATCH = "1";
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got).toEqual(HEAD);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("probe failure → 200 with unmodified body (fail-safe)", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD))
      .mockRejectedValueOnce(new Error("probe network down"));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(HEAD);
  });

  it("403-retry path probes the fresh URL, not the stale one", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/stale", ext: "m4a" }) });
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/fresh", ext: "m4a" }) });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 })) // stale main
      .mockResolvedValueOnce(upstreamResponse(HEAD)) // fresh main
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 })); // probe
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(readU32(got, 48)).toBe(0);
    // Probe (3rd fetch) hit the fresh URL.
    expect(String(fetchSpy.mock.calls[2][0])).toBe("https://cdn/fresh");
  });

  it("probe result is cached — second request issues no second probe", async () => {
    await makeUserSession();
    mockSpawnOnce({ stdout: ytDlpJson({ ext: "m4a" }) });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse(HEAD))
      .mockResolvedValueOnce(upstreamResponse(HEAD, { status: 206 }))
      .mockResolvedValueOnce(upstreamResponse(HEAD));
    await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const res = await audioGET(audioReq(VID), ctx({ videoId: VID }));
    const got = new Uint8Array(await res.arrayBuffer());
    expect(readU32(got, 48)).toBe(0);
    // main + probe + main — no 4th call.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

// === resolveAudio with optional Piped fallback ============================

const PIPED_BASE = "https://piped.test.example";

function enablePiped() {
  process.env.PIPED_API_BASE_URL = PIPED_BASE;
  resetPlaybackProvidersForTests();
}

function pipedAudioStreams(streams: Array<{ url: string; mimeType?: string; contentLength?: number }>): unknown {
  return { audioStreams: streams };
}

describe("resolveAudio with Piped fallback configured", () => {
  it("yt-dlp success short-circuits Piped (fetch never called)", async () => {
    enablePiped();
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/yt.m4a" }) });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const stream = await resolveAudio(VID);
    expect(stream.provider).toBe("yt-dlp");
    expect(stream.url).toBe("https://cdn/yt.m4a");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("yt-dlp fails + Piped success → returns provider:'piped'", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          pipedAudioStreams([
            { url: "https://piped-cdn/x.m4a", mimeType: "audio/mp4", contentLength: 999 },
          ]),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const stream = await resolveAudio(VID);
    expect(stream.provider).toBe("piped");
    expect(stream.url).toBe("https://piped-cdn/x.m4a");
    expect(stream.contentType).toBe("audio/mp4");
    expect(stream.contentLength).toBe(999);
  });

  it("yt-dlp fails + Piped fails → all_providers_failed with both in detail", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 502 }),
    );
    let caught: ResolveError | null = null;
    try {
      await resolveAudio(VID);
    } catch (err) {
      caught = err as ResolveError;
    }
    expect(caught).toBeInstanceOf(ResolveError);
    expect(caught!.code).toBe("all_providers_failed");
    expect(caught!.detail).toContain("yt-dlp:");
    expect(caught!.detail).toContain("piped:");
    expect(caught!.detail).toContain("502");
  });

  it("Piped HTTP non-OK → extract_failed mentions status", async () => {
    enablePiped();
    mockSpawnOnce({ exitCode: 1, stderr: "boom" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("err", { status: 503 }),
    );
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });

  it("Piped 200 with empty audioStreams → extract_failed", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ audioStreams: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  });

  it("Piped malformed body (missing audioStreams) → extract_failed, no TypeError", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(resolveAudio(VID)).rejects.toBeInstanceOf(ResolveError);
  });

  it("Piped audioStreams = string (wrong type) → extract_failed, no TypeError", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ audioStreams: "nope" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(resolveAudio(VID)).rejects.toBeInstanceOf(ResolveError);
  });

  it("prefers audio/mp4 over audio/webm in Piped audioStreams", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          pipedAudioStreams([
            { url: "https://piped/webm", mimeType: "audio/webm" },
            { url: "https://piped/mp4", mimeType: "audio/mp4" },
            { url: "https://piped/other" },
          ]),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const stream = await resolveAudio(VID);
    expect(stream.url).toBe("https://piped/mp4");
    expect(stream.contentType).toBe("audio/mp4");
  });

  it("falls back to first stream when no mp4/webm mime types present", async () => {
    enablePiped();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(pipedAudioStreams([{ url: "https://piped/anything" }])),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const stream = await resolveAudio(VID);
    expect(stream.url).toBe("https://piped/anything");
    expect(stream.provider).toBe("piped");
  });

  it("Piped unconfigured: yt-dlp failure surfaces original code (not all_providers_failed)", async () => {
    // No enablePiped() — only yt-dlp registered.
    mockSpawnOnce({ spawnError: enoentError() });
    await expect(resolveAudio(VID)).rejects.toMatchObject({
      code: "yt_dlp_missing",
    });
  });

  it("cache hit short-circuits both providers", async () => {
    enablePiped();
    mockSpawnOnce({ stdout: ytDlpJson({ url: "https://cdn/once" }) });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await resolveAudio(VID);
    spawnMock.mockReset();
    await resolveAudio(VID);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// === audio-status surfaces all_providers_failed ===========================

describe("GET /api/youtube/audio-status with Piped configured", () => {
  it("502 + all_providers_failed when both fail; detail names both", async () => {
    enablePiped();
    await makeUserSession();
    mockSpawnOnce({ exitCode: 1, stderr: "boom" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 502 }),
    );
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      code: "all_providers_failed",
    });
    expect(body.detail).toContain("yt-dlp:");
    expect(body.detail).toContain("piped:");
  });

  it("piped success path: response includes provider:'piped'", async () => {
    enablePiped();
    await makeUserSession();
    mockSpawnOnce({ spawnError: enoentError() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          pipedAudioStreams([
            { url: "https://piped/x.m4a", mimeType: "audio/mp4" },
          ]),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await audioStatusGET(statusReq(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      provider: "piped",
      contentType: "audio/mp4",
    });
  });
});
