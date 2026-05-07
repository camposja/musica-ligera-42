import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test_youtube_key";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
});

import { parseYoutubeMetadata, searchYoutube } from "@/lib/youtube-search";

// === parseYoutubeMetadata ==================================================

describe("parseYoutubeMetadata", () => {
  it("splits 'Artist - Title'", () => {
    expect(parseYoutubeMetadata("Adele - Hello", "AdeleVEVO")).toEqual({
      title: "Hello",
      artist: "Adele",
    });
  });

  it("handles unicode dashes (en/em)", () => {
    expect(parseYoutubeMetadata("Adele – Hello", "AdeleVEVO")).toEqual({
      title: "Hello",
      artist: "Adele",
    });
    expect(parseYoutubeMetadata("Adele — Hello", "AdeleVEVO")).toEqual({
      title: "Hello",
      artist: "Adele",
    });
  });

  it("uses first separator only (multi-hyphen titles)", () => {
    expect(
      parseYoutubeMetadata("Tom Petty - Learning To Fly - Live", "TomPettyVEVO"),
    ).toEqual({
      title: "Learning To Fly - Live",
      artist: "Tom Petty",
    });
  });

  it("strips ' - Topic' from channel when title has no separator", () => {
    expect(parseYoutubeMetadata("Promiscuità", "Thegiornalisti - Topic")).toEqual({
      title: "Promiscuità",
      artist: "Thegiornalisti",
    });
  });

  it("strips trailing 'VEVO' from channel when title has no separator", () => {
    expect(parseYoutubeMetadata("Some Song", "MangoVEVO")).toEqual({
      title: "Some Song",
      artist: "Mango",
    });
  });

  it("falls back to cleaned channel when title has no separator", () => {
    expect(parseYoutubeMetadata("Yesterday", "The Beatles - Topic")).toEqual({
      title: "Yesterday",
      artist: "The Beatles",
    });
  });

  it("does not split on a single hyphen with no spaces", () => {
    // "Re-mastered" should stay as-is, not split into "Re" + "mastered".
    expect(parseYoutubeMetadata("Bohemian Re-mastered", "Queen")).toEqual({
      title: "Bohemian Re-mastered",
      artist: "Queen",
    });
  });

  it("trims whitespace", () => {
    expect(parseYoutubeMetadata("  Adele  -  Hello  ", "  Channel  ")).toEqual({
      title: "Hello",
      artist: "Adele",
    });
  });
});

// === searchYoutube (mocked fetch) ==========================================

type MockedResponse = {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
};

function makeResponse(spec: MockedResponse): Response {
  const headers = new Headers(spec.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(spec.json ?? {}), {
    status: spec.status,
    headers,
  });
}

function mockFetchSequence(responses: MockedResponse[]) {
  let i = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (i >= responses.length) {
      throw new Error(
        `mockFetchSequence exhausted at call #${i + 1}; only ${responses.length} responses queued`,
      );
    }
    return makeResponse(responses[i++]);
  });
}

const PAD = (s: string) => (s + "X".repeat(11)).slice(0, 11);

function searchResp(ids: string[]): MockedResponse {
  return {
    status: 200,
    json: { items: ids.map((id) => ({ id: { videoId: id } })) },
  };
}

function videosResp(
  items: Array<{
    id: string;
    title?: string;
    channel?: string;
    isPrivate?: boolean;
    thumbnailUrl?: string;
  }>,
): MockedResponse {
  return {
    status: 200,
    json: {
      items: items.map((it) => ({
        id: it.id,
        snippet: {
          title: it.title ?? "Adele - Hello",
          channelTitle: it.channel ?? "AdeleVEVO",
          thumbnails: it.thumbnailUrl
            ? { medium: { url: it.thumbnailUrl } }
            : undefined,
        },
        status: {
          embeddable: true,
          privacyStatus: it.isPrivate ? "private" : "public",
        },
        contentDetails: { duration: "PT3M30S", contentRating: {} },
      })),
    },
  };
}

describe("searchYoutube", () => {
  it("returns rich results in YouTube relevance order", async () => {
    mockFetchSequence([
      searchResp([PAD("a"), PAD("b")]),
      videosResp([
        {
          id: PAD("a"),
          title: "Adele - Hello (Official)",
          channel: "AdeleVEVO",
          thumbnailUrl: "https://i.ytimg.com/vi/a/mqdefault.jpg",
        },
        {
          id: PAD("b"),
          title: "Hello cover",
          channel: "Random",
          thumbnailUrl: null as unknown as string,
        },
      ]),
    ]);
    const r = await searchYoutube("hello adele");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      youtubeId: PAD("a"),
      title: "Adele - Hello (Official)",
      channel: "AdeleVEVO",
      url: `https://www.youtube.com/watch?v=${PAD("a")}`,
      durationSec: 210,
    });
    expect(r[0].thumbnailUrl).toBe("https://i.ytimg.com/vi/a/mqdefault.jpg");
    expect(r[1].thumbnailUrl).toBeNull();
  });

  it("filters out private videos", async () => {
    mockFetchSequence([
      searchResp([PAD("a"), PAD("b")]),
      videosResp([
        { id: PAD("a"), isPrivate: true },
        { id: PAD("b") },
      ]),
    ]);
    const r = await searchYoutube("x");
    expect(r.map((x) => x.youtubeId)).toEqual([PAD("b")]);
  });

  it("returns [] when search has zero items", async () => {
    mockFetchSequence([{ status: 200, json: { items: [] } }]);
    const r = await searchYoutube("nothingness");
    expect(r).toEqual([]);
  });

  it("maps 403 to YoutubeError(403)", async () => {
    mockFetchSequence([{ status: 403, json: { error: "quota" } }]);
    await expect(searchYoutube("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 403,
    });
  });

  it("maps 429 with Retry-After to YoutubeError(429, retryAfterSeconds)", async () => {
    mockFetchSequence([
      { status: 429, json: {}, headers: { "retry-after": "12" } },
    ]);
    await expect(searchYoutube("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 429,
      retryAfterSeconds: 12,
    });
  });

  it("throws YoutubeError(0) when YOUTUBE_API_KEY is missing", async () => {
    process.env.YOUTUBE_API_KEY = "";
    await expect(searchYoutube("x")).rejects.toMatchObject({
      name: "YoutubeError",
      httpStatus: 0,
    });
  });
});
