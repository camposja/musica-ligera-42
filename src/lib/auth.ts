import { readSessionCookie, type Session } from "@/lib/session";

export async function getSession(): Promise<Session | null> {
  return await readSessionCookie();
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
