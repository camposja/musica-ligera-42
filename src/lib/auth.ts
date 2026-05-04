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

export function effectiveUserId(session: Session): string | null {
  if (session.role === "USER") return session.userId;
  if (session.role === "OWNER" && session.actingUserId) {
    return session.actingUserId;
  }
  return null;
}
