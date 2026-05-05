import { getSession, unauthorized } from "@/lib/auth";
import { getConnectionInfo } from "@/lib/spotify-oauth";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const info = await getConnectionInfo();
  return Response.json(info);
}
