import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  jsonRequest,
  prisma,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

import { GET as settingsGET, PATCH as settingsPATCH } from "@/app/api/settings/route";

async function makeUser() {
  return await prisma.user.create({
    data: { name: "child", role: "USER", accessCode: "0000" },
  });
}

describe("GET /api/settings", () => {
  it("401 without session", async () => {
    const res = await settingsGET();
    expect(res.status).toBe(401);
  });

  it("403 for USER", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await settingsGET();
    expect(res.status).toBe(403);
  });

  it("OWNER gets defaults when row is missing", async () => {
    await setOwnerSession();
    const res = await settingsGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowChildSpotifyLogin: boolean };
    expect(body.allowChildSpotifyLogin).toBe(false);
  });

  it("OWNER reads the persisted value", async () => {
    await setOwnerSession();
    await prisma.appSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", allowChildSpotifyLogin: true },
      update: { allowChildSpotifyLogin: true },
    });
    const res = await settingsGET();
    const body = (await res.json()) as { allowChildSpotifyLogin: boolean };
    expect(body.allowChildSpotifyLogin).toBe(true);
  });
});

describe("PATCH /api/settings", () => {
  it("401 without session", async () => {
    const res = await settingsPATCH(
      jsonRequest("http://x/api/settings", { allowChildSpotifyLogin: true }, "PATCH"),
    );
    expect(res.status).toBe(401);
  });

  it("403 for USER", async () => {
    const u = await makeUser();
    await setUserSession(u.id);
    const res = await settingsPATCH(
      jsonRequest("http://x/api/settings", { allowChildSpotifyLogin: true }, "PATCH"),
    );
    expect(res.status).toBe(403);
  });

  it("400 when allowChildSpotifyLogin is not a boolean", async () => {
    await setOwnerSession();
    const res = await settingsPATCH(
      jsonRequest("http://x/api/settings", { allowChildSpotifyLogin: "yes" }, "PATCH"),
    );
    expect(res.status).toBe(400);
  });

  it("OWNER toggles the flag and the response reflects the new state", async () => {
    await setOwnerSession();
    const res = await settingsPATCH(
      jsonRequest("http://x/api/settings", { allowChildSpotifyLogin: true }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowChildSpotifyLogin: boolean };
    expect(body.allowChildSpotifyLogin).toBe(true);

    const row = await prisma.appSetting.findUnique({ where: { id: "singleton" } });
    expect(row?.allowChildSpotifyLogin).toBe(true);
  });

  it("OWNER can toggle the flag back off", async () => {
    await setOwnerSession();
    await prisma.appSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", allowChildSpotifyLogin: true },
      update: { allowChildSpotifyLogin: true },
    });
    const res = await settingsPATCH(
      jsonRequest("http://x/api/settings", { allowChildSpotifyLogin: false }, "PATCH"),
    );
    const body = (await res.json()) as { allowChildSpotifyLogin: boolean };
    expect(body.allowChildSpotifyLogin).toBe(false);
  });
});
