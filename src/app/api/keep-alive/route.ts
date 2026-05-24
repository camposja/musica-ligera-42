import { getSession, unauthorized } from "@/lib/auth";

// Purely a traffic generator for Fly autostop. No DB, no cache.
// Auth is mandatory here, not just inherited from layout gating.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  return Response.json(
    { ok: true, serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
