import { SignJWT, jwtVerify } from "jose";
import type { Session } from "@/lib/session";
import { assertExactAudience, getSecret, isSession } from "@/lib/session";

/// Bearer tokens for the one-way iOS import API. Deliberately a *separate*
/// credential from the web session cookie: `/api/ios/*` accepts only bearer
/// tokens, every other route accepts only cookies, and neither token is valid
/// on the other's path (see `assertExactAudience`).
export const IOS_AUDIENCE = "ios-import";

/// Role-dependent lifetime. A USER token unlocks one library; an OWNER token can
/// export *every* account, so it expires in a day rather than a week. The TTL is
/// derived from the session here on purpose — callers cannot choose it.
const MAX_AGE_USER_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_AGE_OWNER_SECONDS = 60 * 60 * 24; // 24 hours

export function iosTokenMaxAgeSeconds(session: Session): number {
  return session.role === "OWNER" ? MAX_AGE_OWNER_SECONDS : MAX_AGE_USER_SECONDS;
}

export async function signIosToken(
  session: Session,
): Promise<{ token: string; expiresAt: Date }> {
  const maxAge = iosTokenMaxAgeSeconds(session);
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  const token = await new SignJWT({ s: session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(IOS_AUDIENCE)
    .setExpirationTime(`${maxAge}s`)
    .sign(getSecret());
  return { token, expiresAt };
}

export async function verifyIosToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
      audience: IOS_AUDIENCE,
    });
    // The `audience` option above is necessary but NOT sufficient: jose passes
    // when the expected value is *contained in* `aud`, so `["ios-import","web"]`
    // would satisfy it and the token would be valid on both paths. Re-check the
    // claim exactly. Do not delete this as redundant.
    if (!assertExactAudience(payload, IOS_AUDIENCE)) return null;
    const s = (payload as { s?: unknown }).s;
    if (!isSession(s)) return null;
    return s;
  } catch {
    return null;
  }
}
