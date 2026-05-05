import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { deleteConnection } from "@/lib/spotify-oauth";

export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  await deleteConnection();
  return Response.json({ ok: true });
}
