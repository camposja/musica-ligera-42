import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  emptyRequest,
  jsonRequest,
  prisma,
  truncateAll,
} from "./helpers";
import { __resetThrottleForTests, IDENTITY_LIMIT } from "@/lib/throttle";
import { signIosToken } from "@/lib/ios-token";
import { getSecret, signSession } from "@/lib/session";
import type { Session } from "@/lib/session";

import { POST as iosAuth } from "@/app/api/ios/auth/route";
import { GET as iosAccounts } from "@/app/api/ios/accounts/route";
import { GET as iosPlaylists } from "@/app/api/ios/playlists/route";
import { POST as iosExport } from "@/app/api/ios/export/route";

const AUTH_URL = "http://localhost/api/ios/auth";
const ACCOUNTS_URL = "http://localhost/api/ios/accounts";
const PLAYLISTS_URL = "http://localhost/api/ios/playlists";
const EXPORT_URL = "http://localhost/api/ios/export";

function bearer(url: string, token: string, method = "GET"): Request {
  return new Request(url, { method, headers: { authorization: `Bearer ${token}` } });
}

function bearerJson(url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedUser(name: string, accessCode = "code-1") {
  return await prisma.user.create({
    data: { name, role: "USER", accessCode },
  });
}

async function seedPlaylistWithSongs(
  userId: string,
  name: string,
  songs: Array<{ title: string; youtubeId?: string | null; altIds?: string[] }>,
) {
  const playlist = await prisma.playlist.create({ data: { name, userId } });
  let order = 0;
  for (const s of songs) {
    const song = await prisma.song.create({
      data: {
        title: s.title,
        artist: "Artist",
        youtubeId: s.youtubeId ?? null,
        youtubeAltIdsJson: JSON.stringify(s.altIds ?? []),
      },
    });
    await prisma.playlistSong.create({
      data: { playlistId: playlist.id, songId: song.id, order: order++ },
    });
  }
  return playlist;
}

beforeEach(async () => {
  clearCookies();
  __resetThrottleForTests();
  await truncateAll();
  process.env.IOS_IMPORT_ENABLED = "true";
});

describe("feature gate", () => {
  it("404s every /api/ios/* route while dormant (never 403 — a 403 would advertise the endpoint)", async () => {
    process.env.IOS_IMPORT_ENABLED = "false";
    const responses = await Promise.all([
      iosAuth(jsonRequest(AUTH_URL, { type: "OWNER", username: "x", password: "y" })),
      iosAccounts(emptyRequest(ACCOUNTS_URL)),
      iosPlaylists(emptyRequest(PLAYLISTS_URL)),
      iosExport(jsonRequest(EXPORT_URL, { playlistIds: ["a"] })),
    ]);
    for (const res of responses) expect(res.status).toBe(404);
  });

  it("404s dormant even with a valid token", async () => {
    const user = await seedUser("Ana");
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    process.env.IOS_IMPORT_ENABLED = "false";
    const res = await iosPlaylists(bearer(PLAYLISTS_URL, token));
    expect(res.status).toBe(404);
  });
});

describe("auth route", () => {
  it("mints a token for a valid USER and never sets a cookie", async () => {
    const user = await seedUser("Ana", "secret-code");
    const res = await iosAuth(
      jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "secret-code" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.role).toBe("USER");
    expect(body.userId).toBe(user.id);
    expect(typeof body.token).toBe("string");
  });

  it("returns the same generic 401 for unknown identity and wrong secret", async () => {
    await seedUser("Ana", "right-code");
    const wrongCode = await iosAuth(
      jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "wrong" }),
    );
    __resetThrottleForTests();
    const unknown = await iosAuth(
      jsonRequest(AUTH_URL, { type: "USER", name: "nobody", accessCode: "right-code" }),
    );
    expect(wrongCode.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrongCode.json()).toEqual(await unknown.json());
  });

  it("throttles repeated attempts against one identity with Retry-After", async () => {
    await seedUser("Ana", "right-code");
    let last: Response | undefined;
    for (let i = 0; i < IDENTITY_LIMIT + 1; i++) {
      last = await iosAuth(
        jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "wrong" }),
      );
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await last!.json()).code).toBe("throttled");
  });

  it("a successful login clears the identity bucket so real users are not locked out", async () => {
    await seedUser("Ana", "right-code");
    // Burn almost the whole identity allowance with failures.
    for (let i = 0; i < IDENTITY_LIMIT - 1; i++) {
      await iosAuth(jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "wrong" }));
    }
    const good = await iosAuth(
      jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "right-code" }),
    );
    expect(good.status).toBe(200);

    // Without the reset, the very next attempt would be throttled. A legitimate
    // user signing in repeatedly (several devices, cleared cookies) must not be
    // locked out by their own successes.
    for (let i = 0; i < IDENTITY_LIMIT - 1; i++) {
      const again = await iosAuth(
        jsonRequest(AUTH_URL, { type: "USER", name: "ana", accessCode: "right-code" }),
      );
      expect(again.status).toBe(200);
    }
  });

  it("OWNER tokens expire in 24h and USER tokens in 7d", async () => {
    const user = await seedUser("Ana");
    const owner = await signIosToken({ role: "OWNER" });
    const regular = await signIosToken({ role: "USER", userId: user.id });
    const hours = (d: Date) => (d.getTime() - Date.now()) / 3_600_000;
    expect(hours(owner.expiresAt)).toBeGreaterThan(23);
    expect(hours(owner.expiresAt)).toBeLessThanOrEqual(24);
    expect(hours(regular.expiresAt)).toBeGreaterThan(24 * 7 - 1);
    expect(hours(regular.expiresAt)).toBeLessThanOrEqual(24 * 7);
  });
});

describe("token non-interchangeability", () => {
  it("rejects a request with no Authorization header", async () => {
    expect((await iosPlaylists(emptyRequest(PLAYLISTS_URL))).status).toBe(401);
  });

  it("rejects a malformed bearer value", async () => {
    const res = await iosPlaylists(
      new Request(PLAYLISTS_URL, { headers: { authorization: "Bearer not-a-jwt" } }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a WEB session cookie JWT presented as a bearer token", async () => {
    const user = await seedUser("Ana");
    const webToken = await signSession({ role: "USER", userId: user.id });
    const res = await iosPlaylists(bearer(PLAYLISTS_URL, webToken));
    expect(res.status).toBe(401);
  });

  it("rejects an iOS token used as a web session cookie", async () => {
    const user = await seedUser("Ana");
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const { verifySessionToken } = await import("@/lib/session");
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects an array-valued audience on BOTH paths (jose's audience option alone would pass this)", async () => {
    const user = await seedUser("Ana");
    const session: Session = { role: "USER", userId: user.id };
    const multi = await new SignJWT({ s: session })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setAudience(["ios-import", "web"])
      .setExpirationTime("1h")
      .sign(getSecret());

    const { verifyIosToken } = await import("@/lib/ios-token");
    const { verifySessionToken } = await import("@/lib/session");
    expect(await verifyIosToken(multi)).toBeNull();
    expect(await verifySessionToken(multi)).toBeNull();
  });

  it("rejects a bearer token with no audience at all", async () => {
    const user = await seedUser("Ana");
    const noAud = await new SignJWT({ s: { role: "USER", userId: user.id } })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(getSecret());
    const { verifyIosToken } = await import("@/lib/ios-token");
    expect(await verifyIosToken(noAud)).toBeNull();
  });

  it("still accepts a legacy cookie with no audience (transition window)", async () => {
    const user = await seedUser("Ana");
    const legacy = await new SignJWT({ s: { role: "USER", userId: user.id } })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(getSecret());
    const { verifySessionToken } = await import("@/lib/session");
    expect(await verifySessionToken(legacy)).toEqual({ role: "USER", userId: user.id });
  });

  it("rejects an expired iOS token", async () => {
    const user = await seedUser("Ana");
    const expired = await new SignJWT({ s: { role: "USER", userId: user.id } })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setAudience("ios-import")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(getSecret());
    expect((await iosPlaylists(bearer(PLAYLISTS_URL, expired))).status).toBe(401);
  });
});

describe("authorization matrix", () => {
  it("USER lists own playlists", async () => {
    const user = await seedUser("Ana");
    await seedPlaylistWithSongs(user.id, "Mine", [{ title: "A", youtubeId: "v1" }]);
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const res = await iosPlaylists(bearer(PLAYLISTS_URL, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playlists).toHaveLength(1);
    expect(body.playlists[0].songCount).toBe(1);
    expect(body.playlists[0].matchedCount).toBe(1);
  });

  it("USER naming another account gets 403, never a silent fallback to self", async () => {
    const ana = await seedUser("Ana");
    const bob = await seedUser("Bob", "code-2");
    await seedPlaylistWithSongs(bob.id, "Bob's", [{ title: "B" }]);
    const { token } = await signIosToken({ role: "USER", userId: ana.id });
    const res = await iosPlaylists(bearer(`${PLAYLISTS_URL}?userId=${bob.id}`, token));
    expect(res.status).toBe(403);
  });

  it("USER cannot list accounts", async () => {
    const user = await seedUser("Ana");
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    expect((await iosAccounts(bearer(ACCOUNTS_URL, token))).status).toBe(403);
  });

  it("OWNER lists accounts with playlist counts", async () => {
    const ana = await seedUser("Ana");
    await seedPlaylistWithSongs(ana.id, "P1", [{ title: "A" }]);
    const { token } = await signIosToken({ role: "OWNER" });
    const res = await iosAccounts(bearer(ACCOUNTS_URL, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([
      { id: ana.id, name: "Ana", playlistCount: 1 },
    ]);
  });

  it("OWNER without userId gets 400 account_required", async () => {
    const { token } = await signIosToken({ role: "OWNER" });
    const res = await iosPlaylists(bearer(PLAYLISTS_URL, token));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("account_required");
  });

  it("OWNER naming a non-existent account gets 403 (no id enumeration)", async () => {
    const { token } = await signIosToken({ role: "OWNER" });
    const res = await iosPlaylists(
      bearer(`${PLAYLISTS_URL}?userId=does-not-exist`, token),
    );
    expect(res.status).toBe(403);
  });

  it("OWNER exports any account", async () => {
    const ana = await seedUser("Ana");
    const p = await seedPlaylistWithSongs(ana.id, "Ana's", [{ title: "A", youtubeId: "v1" }]);
    const { token } = await signIosToken({ role: "OWNER" });
    const res = await iosExport(
      bearerJson(EXPORT_URL, token, { playlistIds: [p.id], userId: ana.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.name).toBe("Ana");
    expect(body.playlists[0].songs[0].title).toBe("A");
  });

  it("exporting a playlist owned by someone else is 403, not a filtered 200", async () => {
    const ana = await seedUser("Ana");
    const bob = await seedUser("Bob", "code-2");
    const bobsList = await seedPlaylistWithSongs(bob.id, "Bob's", [{ title: "B" }]);
    const { token } = await signIosToken({ role: "USER", userId: ana.id });
    const res = await iosExport(
      bearerJson(EXPORT_URL, token, { playlistIds: [bobsList.id] }),
    );
    expect(res.status).toBe(403);
  });
});

describe("export payload", () => {
  it("never leaks youtubeAltIdsJson and exposes youtubeAltIds as an array", async () => {
    const user = await seedUser("Ana");
    const p = await seedPlaylistWithSongs(user.id, "P", [
      { title: "A", youtubeId: "v1", altIds: ["alt1", "alt2"] },
    ]);
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const res = await iosExport(bearerJson(EXPORT_URL, token, { playlistIds: [p.id] }));
    const raw = await res.text();
    expect(raw).not.toContain("youtubeAltIdsJson");
    const body = JSON.parse(raw);
    expect(body.playlists[0].songs[0].youtubeAltIds).toEqual(["alt1", "alt2"]);
    expect(body.schemaVersion).toBe(1);
  });

  it("returns songs in `order` order and emits order explicitly", async () => {
    const user = await seedUser("Ana");
    const p = await seedPlaylistWithSongs(user.id, "P", [
      { title: "first" },
      { title: "second" },
      { title: "third" },
    ]);
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const res = await iosExport(bearerJson(EXPORT_URL, token, { playlistIds: [p.id] }));
    const body = await res.json();
    expect(body.playlists[0].songs.map((s: { title: string }) => s.title)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(body.playlists[0].songs.map((s: { order: number }) => s.order)).toEqual([0, 1, 2]);
  });

  it("rejects duplicate playlistIds rather than silently deduping", async () => {
    const user = await seedUser("Ana");
    const p = await seedPlaylistWithSongs(user.id, "P", [{ title: "A" }]);
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const res = await iosExport(
      bearerJson(EXPORT_URL, token, { playlistIds: [p.id, p.id] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("duplicate_playlist_ids");
  });

  it("rejects more than 50 playlists before doing any export work", async () => {
    const user = await seedUser("Ana");
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const res = await iosExport(bearerJson(EXPORT_URL, token, { playlistIds: ids }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("export_too_large");
    expect(body.limit).toBe("playlists");
  });

  it("sets Cache-Control: no-store on every route", async () => {
    const user = await seedUser("Ana");
    const p = await seedPlaylistWithSongs(user.id, "P", [{ title: "A" }]);
    const { token } = await signIosToken({ role: "USER", userId: user.id });
    const ownerToken = (await signIosToken({ role: "OWNER" })).token;

    const responses = [
      await iosAuth(jsonRequest(AUTH_URL, { type: "USER", name: "Ana", accessCode: "code-1" })),
      await iosAccounts(bearer(ACCOUNTS_URL, ownerToken)),
      await iosPlaylists(bearer(PLAYLISTS_URL, token)),
      await iosExport(bearerJson(EXPORT_URL, token, { playlistIds: [p.id] })),
    ];
    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("membership limit", () => {
  it("keeps the byte cap and the membership cap mutually consistent", async () => {
    // Measured 370 B/membership on the real library. If the byte cap ever drops
    // back to 2 MB, a full 5,000-membership export (~1.76 MB) would sit at 88%
    // of it and the byte check would start firing before the membership check —
    // rejecting exports that are nominally within limits.
    const { limitsAreConsistent, MAX_SONG_MEMBERSHIPS, ESTIMATED_BYTES_PER_MEMBERSHIP, MAX_ENCODED_RESPONSE_BYTES } =
      await import("@/lib/ios-export-limits");
    expect(limitsAreConsistent()).toBe(true);
    expect(MAX_SONG_MEMBERSHIPS * ESTIMATED_BYTES_PER_MEMBERSHIP).toBeLessThanOrEqual(
      MAX_ENCODED_RESPONSE_BYTES,
    );
  });

  it("rejects an export whose membership count exceeds the cap", async () => {
    const { checkMembershipCount, MAX_SONG_MEMBERSHIPS } = await import(
      "@/lib/ios-export-limits"
    );
    expect(checkMembershipCount(MAX_SONG_MEMBERSHIPS)).toBeNull();
    expect(checkMembershipCount(MAX_SONG_MEMBERSHIPS + 1)).toEqual({
      limit: "memberships",
      max: MAX_SONG_MEMBERSHIPS,
      actual: MAX_SONG_MEMBERSHIPS + 1,
    });
  });
});
