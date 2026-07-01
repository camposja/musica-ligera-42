import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookies,
  jsonRequest,
  prisma,
  setOwnerSession,
  setUserSession,
  truncateAll,
} from "./helpers";
import {
  DELETE as historyDELETE,
  GET as historyGET,
  POST as historyPOST,
} from "@/app/api/search-history/route";
import {
  clearHistory,
  listRecent,
  MAX_HISTORY,
  recordSearch,
} from "@/lib/search-history";

beforeEach(async () => {
  clearCookies();
  await truncateAll();
});

async function makeUser(name: string) {
  return prisma.user.create({ data: { name, role: "USER", accessCode: "x" } });
}

// --- helper (store logic) ---------------------------------------------------

describe("search-history store", () => {
  it("records most-recent-first", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "first");
    await recordSearch(u.id, "library", "second");
    expect(await listRecent(u.id, "library")).toEqual(["second", "first"]);
  });

  it("dedupes on normalized query and moves it to the top (no duplicate row)", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "Hello");
    await recordSearch(u.id, "library", "world");
    await recordSearch(u.id, "library", "  hello  "); // same normalized as "Hello"
    const recent = await listRecent(u.id, "library");
    expect(recent).toEqual(["hello", "world"]); // moved to top, casing refreshed
    const rows = await prisma.searchHistory.findMany({
      where: { userId: u.id, surface: "library" },
    });
    expect(rows).toHaveLength(2);
  });

  it("caps the list at MAX_HISTORY per (user, surface)", async () => {
    const u = await makeUser("alice");
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      await recordSearch(u.id, "library", `q${i}`);
    }
    const recent = await listRecent(u.id, "library");
    expect(recent).toHaveLength(MAX_HISTORY);
    expect(recent[0]).toBe(`q${MAX_HISTORY + 4}`); // newest kept
    expect(recent).not.toContain("q0"); // oldest pruned
  });

  it("ignores empty / whitespace-only queries", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "   ");
    expect(await listRecent(u.id, "library")).toEqual([]);
  });

  it("scopes per surface", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "libq");
    await recordSearch(u.id, "spotify", "spq");
    expect(await listRecent(u.id, "library")).toEqual(["libq"]);
    expect(await listRecent(u.id, "spotify")).toEqual(["spq"]);
    expect(await listRecent(u.id, "youtube")).toEqual([]);
  });

  it("clearHistory clears only that surface", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "libq");
    await recordSearch(u.id, "spotify", "spq");
    await clearHistory(u.id, "library");
    expect(await listRecent(u.id, "library")).toEqual([]);
    expect(await listRecent(u.id, "spotify")).toEqual(["spq"]);
  });
});

// --- route auth + validation ------------------------------------------------

describe("search-history route auth + validation", () => {
  it("GET 401 without session", async () => {
    const res = await historyGET(
      new Request("http://x/api/search-history?surface=library"),
    );
    expect(res.status).toBe(401);
  });

  it("GET 403 for OWNER not impersonating", async () => {
    await setOwnerSession();
    const res = await historyGET(
      new Request("http://x/api/search-history?surface=library"),
    );
    expect(res.status).toBe(403);
  });

  it("GET 400 for an invalid surface", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await historyGET(
      new Request("http://x/api/search-history?surface=bogus"),
    );
    expect(res.status).toBe(400);
  });

  it("POST 400 for empty query", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    const res = await historyPOST(
      jsonRequest("http://x", { surface: "library", query: "  " }),
    );
    expect(res.status).toBe(400);
  });
});

// --- route behavior + scoping ----------------------------------------------

describe("search-history route behavior", () => {
  it("POST records and GET lists for the same user", async () => {
    const u = await makeUser("alice");
    await setUserSession(u.id);
    await historyPOST(jsonRequest("http://x", { surface: "library", query: "hello" }));
    const res = await historyGET(
      new Request("http://x/api/search-history?surface=library"),
    );
    const body = await res.json();
    expect(body.queries).toEqual(["hello"]);
  });

  it("does not leak another user's history", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    await recordSearch(bob.id, "library", "bob-secret");
    await setUserSession(alice.id);
    const res = await historyGET(
      new Request("http://x/api/search-history?surface=library"),
    );
    const body = await res.json();
    expect(body.queries).toEqual([]);
  });

  it("DELETE one removes a single entry", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "keep");
    await recordSearch(u.id, "library", "drop");
    await setUserSession(u.id);
    await historyDELETE(jsonRequest("http://x", { surface: "library", query: "drop" }, "DELETE"));
    expect(await listRecent(u.id, "library")).toEqual(["keep"]);
  });

  it("DELETE all clears the surface", async () => {
    const u = await makeUser("alice");
    await recordSearch(u.id, "library", "a");
    await recordSearch(u.id, "library", "b");
    await setUserSession(u.id);
    await historyDELETE(jsonRequest("http://x", { surface: "library", all: true }, "DELETE"));
    expect(await listRecent(u.id, "library")).toEqual([]);
  });
});
