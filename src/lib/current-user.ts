import { redirect } from "next/navigation";
import { effectiveUserId, getSession } from "@/lib/auth";
import type { Session } from "@/lib/session";

export async function getRequiredSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function getEffectiveUserIdOrNull(session: Session): string | null {
  return effectiveUserId(session);
}
