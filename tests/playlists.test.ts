import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  ctx,
  jsonRequest,
  prisma,
  setOwnerActingSession,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

import {
  GET as listGET,
  POST as listPOST,
} from "@/app/api/playlists/route";
import {
  DELETE as detailDELETE,
  GET as detailGET,
} from "@/app/api/playlists/[id]/route";
import { POST as addSongPOST } from "@/app/api/playlists/[id]/add-song/route";
import { POST as removeSongPOST } from "@/app/api/playlists/[id]/remove-song/route";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, role: "USER", accessCode: "x" },
  });
}

async function makeSong(title: string, artist = "Artist") {
  return prisma.song.create({ data: { title, artist } });
}

describe("auth gating on /api/playlists", () => {
  it("401 with no session", async () => {
    expect((await listGET()).status).toBe(401);
    expect(
      (await listPOST(jsonRequest("http://x/api/playlists", { name: "x" })))
        .status,
    ).toBe(401);
  });

  it("403 for OWNER not impersonating (GET)", async () => {
    await setOwnerSession();
    const res = await listGET();
    expect(res.status).toBe(403);
  });

  it("403 for OWNER not impersonating (POST)", async () => {
    await setOwnerSession();
    const res = await listPOST(
      jsonRequest("http://x/api/playlists", { name: "x" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/playlists", () => {
  it("returns empty array for new user", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await listGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playlists: [] });
  });

  it("returns only the effective user's playlists", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    await prisma.playlist.create({ data: { name: "alice mix", userId: alice.id } });
    await prisma.playlist.create({ data: { name: "bob mix", userId: bob.id } });

    await setUserSession(alice.id);
    const res = await listGET();
    const body = await res.json();
    expect(body.playlists).toHaveLength(1);
    expect(body.playlists[0].name).toBe("alice mix");
  });

  it("OWNER acting sees the impersonated user's playlists", async () => {
    const alice = await makeUser("alice");
    await prisma.playlist.create({ data: { name: "alice mix", userId: alice.id } });
    await setOwnerActingSession(alice.id);
    const res = await listGET();
    const body = await res.json();
    expect(body.playlists).toHaveLength(1);
    expect(body.playlists[0].name).toBe("alice mix");
  });
});

describe("POST /api/playlists", () => {
  it("creates a playlist owned by the effective user", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await listPOST(
      jsonRequest("http://x/api/playlists", { name: "My Mix" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.playlist.name).toBe("My Mix");
    expect(body.playlist.userId).toBe(u.id);

    const dbCount = await prisma.playlist.count({ where: { userId: u.id } });
    expect(dbCount).toBe(1);
  });

  it("creates with the impersonated user when OWNER is acting", async () => {
    const u = await makeUser("alice");
    await setOwnerActingSession(u.id);
    const res = await listPOST(
      jsonRequest("http://x/api/playlists", { name: "owner mix" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.playlist.userId).toBe(u.id);
  });

  it("400 for missing name", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await listPOST(jsonRequest("http://x/api/playlists", {}));
    expect(res.status).toBe(400);
  });

  it("400 for empty name", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await listPOST(
      jsonRequest("http://x/api/playlists", { name: "   " }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/playlists/[id]", () => {
  it("404 for unknown id", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await detailGET(
      new Request("http://x"),
      ctx({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("403 if playlist belongs to another user (cross-user)", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const p = await prisma.playlist.create({
      data: { name: "bob mix", userId: bob.id },
    });
    await setUserSession(alice.id);
    const res = await detailGET(new Request("http://x"), ctx({ id: p.id }));
    expect(res.status).toBe(403);
  });

  it("returns playlist with songs in order", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s1 = await makeSong("first");
    const s2 = await makeSong("second");
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s1.id, order: 0 },
    });
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s2.id, order: 1 },
    });

    await setUserSession(u.id);
    const res = await detailGET(new Request("http://x"), ctx({ id: p.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playlist.songs).toHaveLength(2);
    expect(body.playlist.songs[0].song.title).toBe("first");
    expect(body.playlist.songs[1].song.title).toBe("second");
  });
});

describe("DELETE /api/playlists/[id]", () => {
  it("404 for unknown id", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await detailDELETE(
      new Request("http://x", { method: "DELETE" }),
      ctx({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("403 cross-user", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const p = await prisma.playlist.create({
      data: { name: "bob mix", userId: bob.id },
    });
    await setUserSession(alice.id);
    const res = await detailDELETE(
      new Request("http://x", { method: "DELETE" }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(403);
  });

  it("deletes playlist + join rows but LEAVES songs intact", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s1 = await makeSong("first");
    const s2 = await makeSong("second");
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s1.id, order: 0 },
    });
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s2.id, order: 1 },
    });

    const songsBefore = await prisma.song.count();
    expect(songsBefore).toBe(2);

    await setUserSession(u.id);
    const res = await detailDELETE(
      new Request("http://x", { method: "DELETE" }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(200);

    expect(await prisma.playlist.count()).toBe(0);
    expect(await prisma.playlistSong.count()).toBe(0);
    // The critical spec assertion: songs survive playlist deletion
    expect(await prisma.song.count()).toBe(songsBefore);
  });
});

describe("POST /api/playlists/[id]/add-song", () => {
  it("appends with order = max+1", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s1 = await makeSong("first");
    const s2 = await makeSong("second");
    await setUserSession(u.id);

    const r1 = await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s1.id }),
      ctx({ id: p.id }),
    );
    expect(r1.status).toBe(201);
    expect((await r1.json()).playlistSong.order).toBe(0);

    const r2 = await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s2.id }),
      ctx({ id: p.id }),
    );
    expect(r2.status).toBe(201);
    expect((await r2.json()).playlistSong.order).toBe(1);
  });

  it("409 if song already in playlist", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s1 = await makeSong("first");
    await setUserSession(u.id);

    await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s1.id }),
      ctx({ id: p.id }),
    );
    const dup = await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s1.id }),
      ctx({ id: p.id }),
    );
    expect(dup.status).toBe(409);
  });

  it("404 for missing playlist", async () => {
    const u = await makeUser("alice");
    const s = await makeSong("first");
    await setUserSession(u.id);
    const res = await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s.id }),
      ctx({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  it("404 for missing song", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    await setUserSession(u.id);
    const res = await addSongPOST(
      jsonRequest("http://x/add-song", {
        songId: "00000000-0000-0000-0000-000000000000",
      }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(404);
  });

  it("403 cross-user (cannot add to another user's playlist)", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const p = await prisma.playlist.create({
      data: { name: "bob mix", userId: bob.id },
    });
    const s = await makeSong("first");
    await setUserSession(alice.id);
    const res = await addSongPOST(
      jsonRequest("http://x/add-song", { songId: s.id }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/playlists/[id]/remove-song", () => {
  it("removes the join row; song persists", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s = await makeSong("first");
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s.id, order: 0 },
    });
    await setUserSession(u.id);

    const res = await removeSongPOST(
      jsonRequest("http://x/remove-song", { songId: s.id }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.playlistSong.count()).toBe(0);
    // Song row is untouched
    expect(await prisma.song.count()).toBe(1);
  });

  it("404 if song not in playlist", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s = await makeSong("first");
    await setUserSession(u.id);

    const res = await removeSongPOST(
      jsonRequest("http://x/remove-song", { songId: s.id }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(404);
  });

  it("404 + idempotent: second remove of the same song returns 404", async () => {
    const u = await makeUser("alice");
    const p = await prisma.playlist.create({
      data: { name: "mix", userId: u.id },
    });
    const s = await makeSong("first");
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s.id, order: 0 },
    });
    await setUserSession(u.id);

    expect(
      (
        await removeSongPOST(
          jsonRequest("http://x/remove-song", { songId: s.id }),
          ctx({ id: p.id }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await removeSongPOST(
          jsonRequest("http://x/remove-song", { songId: s.id }),
          ctx({ id: p.id }),
        )
      ).status,
    ).toBe(404);
  });

  it("403 cross-user", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const p = await prisma.playlist.create({
      data: { name: "bob mix", userId: bob.id },
    });
    const s = await makeSong("first");
    await prisma.playlistSong.create({
      data: { playlistId: p.id, songId: s.id, order: 0 },
    });
    await setUserSession(alice.id);

    const res = await removeSongPOST(
      jsonRequest("http://x/remove-song", { songId: s.id }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(403);
  });
});
