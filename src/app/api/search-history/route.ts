import { effectiveUserId, forbidden, getSession, unauthorized } from "@/lib/auth";
import {
  clearHistory,
  deleteSearch,
  isSearchSurface,
  listRecent,
  recordSearch,
} from "@/lib/search-history";

export const dynamic = "force-dynamic";

// Resolve the effective user or return the appropriate error Response.
async function requireEffectiveUser(): Promise<
  { userId: string } | { error: Response }
> {
  const session = await getSession();
  if (!session) return { error: unauthorized() };
  const eid = effectiveUserId(session);
  if (!eid) return { error: forbidden() };
  return { userId: eid };
}

// GET /api/search-history?surface=library|spotify|youtube → { queries: string[] }
export async function GET(request: Request) {
  const auth = await requireEffectiveUser();
  if ("error" in auth) return auth.error;

  const surface = new URL(request.url).searchParams.get("surface");
  if (!isSearchSurface(surface)) {
    return Response.json({ error: "invalid surface" }, { status: 400 });
  }
  const queries = await listRecent(auth.userId, surface);
  return Response.json({ queries });
}

// POST { surface, query } → record a submitted search.
export async function POST(request: Request) {
  const auth = await requireEffectiveUser();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const surface = body?.surface;
  const query = body?.query;
  if (!isSearchSurface(surface)) {
    return Response.json({ error: "invalid surface" }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return Response.json({ error: "query required" }, { status: 400 });
  }
  await recordSearch(auth.userId, surface, query);
  return Response.json({ ok: true });
}

// DELETE { surface, query } → delete one; DELETE { surface, all: true } → clear all.
export async function DELETE(request: Request) {
  const auth = await requireEffectiveUser();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const surface = body?.surface;
  if (!isSearchSurface(surface)) {
    return Response.json({ error: "invalid surface" }, { status: 400 });
  }
  if (body?.all === true) {
    await clearHistory(auth.userId, surface);
    return Response.json({ ok: true });
  }
  const query = body?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return Response.json({ error: "query or all required" }, { status: 400 });
  }
  await deleteSearch(auth.userId, surface, query);
  return Response.json({ ok: true });
}
