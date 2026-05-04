import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  emptyRequest,
  jsonRequest,
  prisma,
  setOwnerActingSession,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as switchPOST } from "@/app/api/auth/switch-user/route";
import { GET as usersGET } from "@/app/api/users/route";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

describe("POST /api/auth/login (OWNER)", () => {
  it("succeeds with env credentials", async () => {
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "OWNER",
        username: "test_owner",
        password: "test_owner_pw",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });

  it("returns 401 for wrong password", async () => {
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "OWNER",
        username: "test_owner",
        password: "wrong",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong username", async () => {
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "OWNER",
        username: "nope",
        password: "test_owner_pw",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/login (USER)", () => {
  it("succeeds with valid name+accessCode", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "letmein" },
    });
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "USER",
        name: "alice",
        accessCode: "letmein",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: "USER", userId: u.id, name: "alice" });
  });

  it("returns 401 for wrong accessCode", async () => {
    await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "letmein" },
    });
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "USER",
        name: "alice",
        accessCode: "wrong",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown name", async () => {
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "USER",
        name: "ghost",
        accessCode: "anything",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects USER login attempt against an OWNER-role row", async () => {
    await prisma.user.create({
      data: { name: "boss", role: "OWNER", accessCode: "x" },
    });
    const res = await loginPOST(
      jsonRequest("http://x/api/auth/login", {
        type: "USER",
        name: "boss",
        accessCode: "x",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 with no session", async () => {
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it("returns OWNER session shape", async () => {
    await setOwnerSession();
    const res = await meGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });

  it("returns OWNER + actingUser shape after switch", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setOwnerActingSession(u.id);
    const res = await meGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: "OWNER",
      actingUserId: u.id,
      actingUserName: "alice",
    });
  });

  it("returns USER session shape", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setUserSession(u.id);
    const res = await meGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: "USER",
      userId: u.id,
      name: "alice",
    });
  });
});

describe("POST /api/auth/switch-user", () => {
  it("returns 403 for USER session", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setUserSession(u.id);
    const res = await switchPOST(
      jsonRequest("http://x/api/auth/switch-user", { userId: u.id }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 with no session", async () => {
    const res = await switchPOST(
      jsonRequest("http://x/api/auth/switch-user", { userId: "x" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing userId", async () => {
    await setOwnerSession();
    const res = await switchPOST(
      jsonRequest("http://x/api/auth/switch-user", {}),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-existent user", async () => {
    await setOwnerSession();
    const res = await switchPOST(
      jsonRequest("http://x/api/auth/switch-user", {
        userId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("succeeds for OWNER switching into a USER", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setOwnerSession();
    const res = await switchPOST(
      jsonRequest("http://x/api/auth/switch-user", { userId: u.id }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: "OWNER",
      actingUserId: u.id,
      actingUserName: "alice",
    });
  });
});

describe("GET /api/users", () => {
  it("returns 401 without session", async () => {
    const res = await usersGET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for USER session", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setUserSession(u.id);
    const res = await usersGET();
    expect(res.status).toBe(403);
  });

  it("returns user list (without accessCode) for OWNER", async () => {
    await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "secret" },
    });
    await setOwnerSession();
    const res = await usersGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ name: "alice", role: "USER" });
    expect(body.users[0]).not.toHaveProperty("accessCode");
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    await setOwnerSession();
    expect((await meGET()).status).toBe(200);
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // After logout, the cookie value is empty -> next /me call sees no valid session
    const after = await meGET();
    expect(after.status).toBe(401);
  });
});

// Avoid an unused import warning when emptyRequest isn't used elsewhere
void emptyRequest;
