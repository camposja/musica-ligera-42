import { featureDisabled, isIosImportEnabled } from "@/lib/ios-flag";
import { iosError, iosJson } from "@/lib/ios-auth";
import { signIosToken } from "@/lib/ios-token";
import {
  authenticateCredentials,
  identityKeyFor,
} from "@/lib/login-credentials";
import { clientIpFrom, recordAttempt, throttled } from "@/lib/throttle";

export const dynamic = "force-dynamic";

/// Mints a bearer token for the one-way iOS import API. Sets NO cookie — this
/// is the native transport, and the two credential types stay separate.
///
/// This is a public credential endpoint, so it is both feature-gated (404 when
/// dormant) and throttled.
export async function POST(request: Request) {
  if (!isIosImportEnabled()) return featureDisabled();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return iosError("Invalid JSON", 400);
  }

  const gate = recordAttempt({
    ip: clientIpFrom(request),
    identity: identityKeyFor(body),
  });
  if (!gate.allowed) return throttled(gate.retryAfterSeconds);

  const result = await authenticateCredentials(body);
  if (!result.ok) {
    if (result.reason === "not_configured") {
      return iosError("Server not configured", 500);
    }
    if (result.reason === "invalid_body" || result.reason === "invalid_type") {
      return iosError("Invalid body", 400);
    }
    // One generic message for unknown identity AND wrong secret — never leak
    // which half failed.
    return iosError("Invalid credentials", 401);
  }

  const { token, expiresAt } = await signIosToken(result.session);

  return iosJson({
    token,
    expiresAt: expiresAt.toISOString(),
    role: result.session.role,
    ...(result.userId ? { userId: result.userId } : {}),
    ...(result.userName ? { name: result.userName } : {}),
  });
}
