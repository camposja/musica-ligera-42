import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  jsonRequest,
  prisma,
  setOwnerActingSession,
  setUserSession,
  truncateAll,
} from "./helpers";

import { GET as listGET, POST as createPOST } from "@/app/api/songs/route";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
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
});
