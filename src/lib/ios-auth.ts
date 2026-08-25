import { verifyIosToken } from "@/lib/ios-token";
import type { Session } from "@/lib/session";

/// Reads the bearer token from an `/api/ios/*` request.
///
/// Deliberately separate from `getSession()` in `auth.ts`: `/api/ios/*` accepts
/// ONLY bearer tokens and every other route accepts ONLY cookies. No route
/// accepts both — that separation is what makes the two credential types
/// non-interchangeable in practice, not just in theory.
export async function getIosSession(request: Request): Promise<Session | null> {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  if (!token) return null;

  return await verifyIosToken(token);
}

/// `Cache-Control: no-store` on every iOS response. These carry auth tokens and
/// private library data; neither may sit in an intermediary cache.
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function iosJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function iosError(
  error: string,
  status: number,
  code?: string,
): Response {
  return Response.json(
    code ? { error, code } : { error },
    { status, headers: NO_STORE },
  );
}
