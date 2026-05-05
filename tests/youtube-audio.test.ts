import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock youtubei.js BEFORE importing anything that touches it.
const mockGetStreamingData = vi.fn();
vi.mock("youtubei.js", () => ({
  Innertube: {
    create: vi.fn(async () => ({ getStreamingData: mockGetStreamingData })),
  },
}));

import { Innertube } from "youtubei.js";
import { clearCookies, ctx, setUserSession, prisma, truncateAll } from "./helpers";
import {
  AudioExtractionError,
  _resetAudioCacheForTests,
  getAudioStreamInfo,
} from "@/lib/youtube-audio";
import { GET as audioGET } from "@/app/api/youtube/audio/[videoId]/route";

const mockedCreate = vi.mocked(Innertube.create);

const VID = "dQw4w9WgXcQ";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  _resetAudioCacheForTests();
  mockGetStreamingData.mockReset();
  mockedCreate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ----------------------------------------------------------------

type FakeFormat = {
  url?: string;
  mime_type?: string;
  content_length?: number;
};

function audioFormat(opts: FakeFormat = {}): FakeFormat {
  return {
    url: "https://cdn/mp4",
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    content_length: 1234567,
    ...opts,
  };
}

async function makeUserSession() {
  const u = await prisma.user.create({
    data: { name: "alice", role: "USER", accessCode: "x" },
  });
  await setUserSession(u.id);
}

// === getAudioStreamInfo ====================================================

describe("getAudioStreamInfo", () => {
  it("returns the URL and stripped content-type from getStreamingData", async () => {
    mockGetStreamingData.mockResolvedValueOnce(
      audioFormat({
        url: "https://cdn/mp4",
        mime_type: 'audio/mp4; codecs="mp4a.40.2"',
        content_length: 4242,
      }),
    );
    const info = await getAudioStreamInfo(VID);
    expect(info.url).toBe("https://cdn/mp4");
    expect(info.contentType).toBe("audio/mp4");
    expect(info.contentLength).toBe(4242);
  });

  it("requests format:'mp4' first, falls back to 'any' when mp4 unavailable", async () => {
    mockGetStreamingData
      .mockRejectedValueOnce(new Error("no mp4 format"))
      .mockResolvedValueOnce(
        audioFormat({
          url: "https://cdn/webm",
          mime_type: 'audio/webm; codecs="opus"',
        }),
      );
    const info = await getAudioStreamInfo(VID);
    expect(info.url).toBe("https://cdn/webm");
    expect(info.contentType).toBe("audio/webm");
    expect(mockGetStreamingData).toHaveBeenCalledTimes(2);
    expect(mockGetStreamingData.mock.calls[0][1]).toMatchObject({
      type: "audio",
      format: "mp4",
    });
    expect(mockGetStreamingData.mock.calls[1][1]).toMatchObject({
      type: "audio",
      format: "any",
    });
  });

  it("throws AudioExtractionError when both mp4 and 'any' fail", async () => {
    mockGetStreamingData
      .mockRejectedValueOnce(new Error("no mp4"))
      .mockRejectedValueOnce(new Error("no audio at all"));
    await expect(getAudioStreamInfo(VID)).rejects.toBeInstanceOf(
      AudioExtractionError,
    );
  });

  it("throws AudioExtractionError when chosen format has no URL", async () => {
    mockGetStreamingData.mockResolvedValueOnce(audioFormat({ url: undefined }));
    await expect(getAudioStreamInfo(VID)).rejects.toBeInstanceOf(
      AudioExtractionError,
    );
  });

  it("throws AudioExtractionError when Innertube.create itself throws", async () => {
    mockedCreate.mockRejectedValueOnce(new Error("network down"));
    await expect(getAudioStreamInfo(VID)).rejects.toBeInstanceOf(
      AudioExtractionError,
    );
  });

  it("caches results by videoId across calls", async () => {
    mockGetStreamingData.mockResolvedValueOnce(
      audioFormat({ url: "https://cdn/once" }),
    );
    const a = await getAudioStreamInfo(VID);
    const b = await getAudioStreamInfo(VID);
    expect(a.url).toBe("https://cdn/once");
    expect(b.url).toBe("https://cdn/once");
    expect(mockGetStreamingData).toHaveBeenCalledTimes(1);
  });

  it("constructs the Innertube client only once across many extractions", async () => {
    mockGetStreamingData.mockResolvedValue(audioFormat());
    await getAudioStreamInfo("aaaaaaaaaaa");
    await getAudioStreamInfo("bbbbbbbbbbb");
    await getAudioStreamInfo("ccccccccccc");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});

// === GET /api/youtube/audio/[videoId] ======================================

function audioRequest(videoId: string, init: RequestInit = {}): Request {
  return new Request(`http://x/api/youtube/audio/${videoId}`, init);
}

describe("GET /api/youtube/audio/[videoId]", () => {
  it("401 without session", async () => {
    const res = await audioGET(audioRequest(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(401);
  });

  it("400 on malformed videoId", async () => {
    await makeUserSession();
    const res = await audioGET(
      audioRequest("not-a-video-id"),
      ctx({ videoId: "not-a-video-id" }),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: 200, forwards content-type, streams body", async () => {
    await makeUserSession();
    mockGetStreamingData.mockResolvedValueOnce(
      audioFormat({ url: "https://cdn/mp4" }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("AUDIO_BYTES", {
        status: 200,
        headers: {
          "content-type": "audio/mp4",
          "content-length": "11",
        },
      }),
    );
    const res = await audioGET(audioRequest(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("AUDIO_BYTES");
  });

  it("forwards Range header upstream and returns 206 + Content-Range", async () => {
    await makeUserSession();
    mockGetStreamingData.mockResolvedValueOnce(
      audioFormat({ url: "https://cdn/mp4" }),
    );
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
      audioRequest(VID, { headers: { range: "bytes=100-199" } }),
      ctx({ videoId: VID }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/2000");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentHeaders = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(sentHeaders.get("range")).toBe("bytes=100-199");
  });

  it("502 extraction_failed when getStreamingData throws", async () => {
    await makeUserSession();
    mockGetStreamingData
      .mockRejectedValueOnce(new Error("no mp4"))
      .mockRejectedValueOnce(new Error("no audio at all"));
    const res = await audioGET(audioRequest(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("extraction_failed");
  });

  it("502 upstream_error when CDN returns 4xx", async () => {
    await makeUserSession();
    mockGetStreamingData.mockResolvedValueOnce(
      audioFormat({ url: "https://cdn/expired" }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    const res = await audioGET(audioRequest(VID), ctx({ videoId: VID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("upstream_error");
    expect(body.upstreamStatus).toBe(403);
  });
});
