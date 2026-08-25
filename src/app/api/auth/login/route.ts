import {
  authenticateCredentials,
  identityKeyFor,
} from "@/lib/login-credentials";
import { setSessionCookie } from "@/lib/session";
import {
  clearIdentityOnSuccess,
  clientIpFrom,
  recordAttempt,
  throttled,
} from "@/lib/throttle";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identity = identityKeyFor(body);
  const gate = recordAttempt({ ip: clientIpFrom(request), identity });
  if (!gate.allowed) return throttled(gate.retryAfterSeconds);

  const result = await authenticateCredentials(body);

  if (!result.ok) {
    switch (result.reason) {
      case "invalid_body":
        return Response.json({ error: "Invalid body" }, { status: 400 });
      case "invalid_type":
        return Response.json({ error: "Invalid type" }, { status: 400 });
      case "not_configured":
        return Response.json({ error: "Server not configured" }, { status: 500 });
      default:
        return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }
  }

  clearIdentityOnSuccess(identity);
  await setSessionCookie(result.session);

  if (result.session.role === "OWNER") return Response.json({ role: "OWNER" });
  return Response.json({
    role: "USER",
    userId: result.userId,
    name: result.userName,
  });
}
