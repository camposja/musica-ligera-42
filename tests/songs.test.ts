import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCookies,
  jsonRequest,
  prisma,
  setOwnerActingSession,
  setUserSession,
  truncateAll,
} from "./helpers";

import * as youtubeModule from "@/lib/youtube";
import { GET as listGET, POST as createPOST } from "@/app/api/songs/route";

let triggerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  clearCookies();
  await truncateAll();
  triggerSpy = vi
    .spyOn(youtubeModule, "triggerMatchInBackground")
    .mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeUser(name = "alice") {
  return prisma.user.create({
    data: { name, role: "USER", accessCode: "x" },
  });
}

describe("auth gating on /api/songs", () => {
  it("GET 401 with no session", async () => {
    expect((await listGET()).status).toBe(401);
  });

  it("POST 401 with no session", async () => {
    expect(
      (
        await createPOST(
          jsonRequest("http://x/api/songs", { title: "t", artist: "a" }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("GET /api/songs", () => {
  it("returns global library (any session)", async () => {
    await prisma.song.create({ data: { title: "one", artist: "a1" } });
    await prisma.song.create({ data: { title: "two", artist: "a2" } });

    const u = await makeUser();
    await setUserSession(u.id);
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.songs).toHaveLength(2);
  });

  it("OWNER acting can list songs (sanity)", async () => {
    await prisma.song.create({ data: { title: "one", artist: "a1" } });
    const u = await makeUser();
    await setOwnerActingSession(u.id);
    const res = await listGET();
    expect(res.status).toBe(200);
    expect((await res.json()).songs).toHaveLength(1);
  });
});

describe("POST /api/songs", () => {
  it("creates with title+artist", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "Song A",
        artist: "Artist A",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.song.title).toBe("Song A");
    expect(body.song.artist).toBe("Artist A");
    expect(body.song.youtubeId).toBeNull();
    expect(body.song.youtubeAltIds).toEqual([]);
  });

  it("accepts album, spotifyId, youtubeId, youtubeAltIds", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "Song",
        artist: "Artist",
        album: "Album",
        spotifyId: "sp1",
        youtubeId: "yt1",
        youtubeAltIds: ["yt2", "yt3"],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.song.album).toBe("Album");
    expect(body.song.spotifyId).toBe("sp1");
    expect(body.song.youtubeId).toBe("yt1");
    expect(body.song.youtubeAltIds).toEqual(["yt2", "yt3"]);
  });

  it("400 missing title", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", { artist: "a" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 missing artist", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", { title: "t" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 if youtubeAltIds is not a string array", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "t",
        artist: "a",
        youtubeAltIds: [1, 2],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns existing song (200) on duplicate spotifyId — find-then-create dedup", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const first = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "t",
        artist: "a",
        spotifyId: "dup",
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "t2",
        artist: "a2",
        spotifyId: "dup",
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    // Same row returned — local fields preserved (not overwritten with t2/a2).
    expect(secondBody.song.id).toBe(firstBody.song.id);
    expect(secondBody.song.title).toBe("t");
    expect(secondBody.song.artist).toBe("a");
    expect(await prisma.song.count()).toBe(1);
  });

  it("creates a new row each time when spotifyId is absent (no dedup key)", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const r1 = await createPOST(
      jsonRequest("http://x/api/songs", { title: "same", artist: "same" }),
    );
    const r2 = await createPOST(
      jsonRequest("http://x/api/songs", { title: "same", artist: "same" }),
    );
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await prisma.song.count()).toBe(2);
  });

  it("dedupes by youtubeId when no spotifyId (YouTube save flow)", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const payload = {
      title: "Hello",
      artist: "Adele",
      youtubeId: "AbCdEfGhIjK",
      youtubeMatchType: "loose",
      youtubeMatchReason: "manual",
    };
    const r1 = await createPOST(jsonRequest("http://x/api/songs", payload));
    expect(r1.status).toBe(201);
    const r2 = await createPOST(jsonRequest("http://x/api/songs", payload));
    expect(r2.status).toBe(200); // existing row returned, not duplicated
    expect(await prisma.song.count()).toBe(1);
  });

  it("persists match metadata fields when client supplies them", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "Hello",
        artist: "Adele",
        youtubeId: "AbCdEfGhIjK",
        youtubeMatchType: "loose",
        youtubeMatchReason: "manual",
        youtubeMatchTitle: "Adele - Hello (Official Audio)",
        youtubeMatchChannel: "AdeleVEVO",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.song.youtubeMatchType).toBe("loose");
    expect(body.song.youtubeMatchReason).toBe("manual");
    expect(body.song.youtubeMatchTitle).toBe("Adele - Hello (Official Audio)");
    expect(body.song.youtubeMatchChannel).toBe("AdeleVEVO");
  });
});

describe("POST /api/songs auto-match trigger", () => {
  it("fires triggerMatchInBackground for newly-created songs without youtubeId", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", { title: "t", artist: "a" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(body.song.id);
  });

  it("does NOT fire trigger when client supplied an explicit youtubeId", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "t",
        artist: "a",
        youtubeId: "explicitYTI",
      }),
    );
    expect(res.status).toBe(201);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire trigger on the existing-song (200) dedup path", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    // Pre-existing row with the spotifyId we're about to POST.
    await prisma.song.create({
      data: { title: "old", artist: "old", spotifyId: "dupYT" },
    });
    triggerSpy.mockClear();

    const res = await createPOST(
      jsonRequest("http://x/api/songs", {
        title: "new",
        artist: "new",
        spotifyId: "dupYT",
      }),
    );
    expect(res.status).toBe(200);
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});
