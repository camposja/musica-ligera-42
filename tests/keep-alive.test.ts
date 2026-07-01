import { beforeEach, describe, expect, it } from "vitest";
import { clearCookies, prisma, setUserSession, truncateAll } from "./helpers";
import { GET as keepAliveGET } from "@/app/api/keep-alive/route";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

describe("GET /api/keep-alive", () => {
  it("401 without a session", async () => {
    const res = await keepAliveGET();
    expect(res.status).toBe(401);
  });

  it("200 { ok: true } for an authenticated session, with no-store", async () => {
    const u = await prisma.user.create({
      data: { name: "alice", role: "USER", accessCode: "x" },
    });
    await setUserSession(u.id);

    const res = await keepAliveGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.serverTime).toBe("number");
  });
});
