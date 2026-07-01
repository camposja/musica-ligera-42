import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  prisma,
  setOwnerActingSession,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";
import { GET as libraryGET } from "@/app/api/library/search/route";
import { rankPlaylists, rankSongs } from "@/lib/library-search";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

async function makeUser(name: string) {
  return prisma.user.create({ data: { name, role: "USER", accessCode: "x" } });
}

async function addSong(
  userId: string,
  data: { title: string; artist: string; album?: string; youtubeId?: string },
  playlistName = "p",
) {
  const song = await prisma.song.create({
    data: {
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      youtubeId: data.youtubeId ?? null,
    },
  });
  const playlist = await prisma.playlist.create({
    data: { name: playlistName, userId },
  });
  await prisma.playlistSong.create({
    data: { playlistId: playlist.id, songId: song.id, order: 0 },
  });
  return { song, playlist };
}

function req(q: string) {
  return new Request(`http://x/api/library/search?q=${encodeURIComponent(q)}`);
}

// --- ranking helper (pure) --------------------------------------------------

describe("library-search ranking", () => {
  it("ranks title match above artist above album-only", () => {
    const songs = [
      { title: "Nothing", artist: "X", album: "hello deluxe" }, // album substring
      { title: "Y", artist: "Hello Band", album: null }, // artist
      { title: "Hello", artist: "Adele", album: null }, // exact title
    ];
    const ranked = rankSongs("hello", songs);
    expect(ranked.map((s) => s.title)).toEqual(["Hello", "Y", "Nothing"]);
  });

  it("prefix beats substring on the same field", () => {
    const ranked = rankSongs("hel", [
      { title: "Say Hello", artist: "A", album: null }, // substring
      { title: "Hello There", artist: "B", album: null }, // prefix
    ]);
    expect(ranked[0].title).toBe("Hello There");
  });

  it("matches multi-word queries across fields (token coverage)", () => {
    const ranked = rankSongs("hello adele", [
      { title: "Hello", artist: "Adele", album: null },
      { title: "Unrelated", artist: "Nobody", album: null },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].title).toBe("Hello");
  });

  it("is diacritic-insensitive", () => {
    const ranked = rankSongs("estereo", [
      { title: "Song", artist: "Bomba Estéreo", album: null },
    ]);
    expect(ranked).toHaveLength(1);
  });

  it("rankPlaylists matches by name", () => {
    const ranked = rankPlaylists("road", [
      { name: "Road Trip" },
      { name: "Chill" },
    ]);
    expect(ranked.map((p) => p.name)).toEqual(["Road Trip"]);
  });
});

// --- route auth -------------------------------------------------------------

describe("GET /api/library/search auth", () => {
  it("401 without session", async () => {
    const res = await libraryGET(req("hello"));
    expect(res.status).toBe(401);
  });

  it("403 for OWNER not impersonating", async () => {
    await setOwnerSession();
    const res = await libraryGET(req("hello"));
    expect(res.status).toBe(403);
  });

  it("400 for empty query", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await libraryGET(req("   "));
    expect(res.status).toBe(400);
  });
});

// --- route behavior + scoping ----------------------------------------------

describe("GET /api/library/search behavior", () => {
  it("returns a USER's own song with its playlist context", async () => {
    const alice = await makeUser("alice");
    const { playlist } = await addSong(
      alice.id,
      { title: "Hello", artist: "Adele", youtubeId: "dQw4w9WgXcQ" },
      "Alice Mix",
    );
    await setUserSession(alice.id);

    const res = await libraryGET(req("hello"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.songs).toHaveLength(1);
    expect(body.songs[0].title).toBe("Hello");
    expect(body.songs[0].playlists).toEqual([
      { id: playlist.id, name: "Alice Mix" },
    ]);
  });

  it("matches playlists by name", async () => {
    const alice = await makeUser("alice");
    await prisma.playlist.create({ data: { name: "Road Trip", userId: alice.id } });
    await setUserSession(alice.id);

    const res = await libraryGET(req("road"));
    const body = await res.json();
    expect(body.playlists.map((p: { name: string }) => p.name)).toEqual([
      "Road Trip",
    ]);
  });

  it("does NOT leak another user's library (no cross-user results)", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    await addSong(bob.id, { title: "Secret Song", artist: "Bob" }, "Bob Mix");
    await setUserSession(alice.id);

    const res = await libraryGET(req("secret"));
    const body = await res.json();
    expect(body.songs).toHaveLength(0);
    expect(body.playlists).toHaveLength(0);
  });

  it("OWNER impersonating sees the acted user's library", async () => {
    const alice = await makeUser("alice");
    await addSong(alice.id, { title: "Hello", artist: "Adele" }, "Alice Mix");
    await setOwnerActingSession(alice.id);

    const res = await libraryGET(req("hello"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.songs).toHaveLength(1);
  });
});
