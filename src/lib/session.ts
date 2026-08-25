import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type Session =
  | { role: "OWNER"; actingUserId?: string }
  | { role: "USER"; userId: string };

const COOKIE_NAME = "ml42_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/// Audience stamped on browser session cookies. Its counterpart is
/// `IOS_AUDIENCE` ("ios-import") in `ios-token.ts`. The two must never be
/// interchangeable: an iOS bearer token replayed as a cookie, or a cookie
/// replayed as a bearer token, must both fail.
export const WEB_AUDIENCE = "web";

/// Exact-match audience check, shared by both verifiers so the rule cannot
/// drift between them.
///
/// This exists because jose's `audience` verification option is necessary but
/// NOT sufficient: it passes when the expected value is *contained in* the
/// token's `aud`, so a token minted with `aud: ["ios-import", "web"]` would
/// satisfy BOTH verifiers and cross the boundary in either direction. Nothing
/// in this system mints an array-valued audience, so any array is rejected
/// outright.
///
/// Rules, in full:
///   - every array-valued audience fails, with no exceptions;
///   - any non-matching string fails;
///   - a MISSING audience fails unless `allowMissing` is true.
///
/// `allowMissing` defaults to false and is the transitional affordance for web
/// cookies ONLY. iOS bearer tokens always call this with `allowMissing=false`;
/// web cookies temporarily pass true, for sessions signed before
/// `WEB_AUDIENCE` existed — without it, deploying this would log out every live
/// session. Dropped once the 7-day cookie TTL rolls over (dated follow-up
/// ticket, not just this comment).
///
/// This is an ADDITION to jose's own verification, never a replacement. The two
/// paths verify different amounts in jose, which is deliberate:
///   - iOS bearer tokens: jose checks signature, expiry, algorithm AND audience,
///     then this exact-string check runs on top.
///   - Web cookies (transition): jose checks signature, expiry and algorithm
///     only. The `audience` option is deliberately NOT passed, because legacy
///     cookies carry no `aud` and jose would reject them outright; this helper
///     then accepts only a missing audience or the exact string "web".
/// Once the transition window closes, the cookie path should also pass
/// `audience: WEB_AUDIENCE` to jose and drop `allowMissing`.
export function assertExactAudience(
  payload: unknown,
  expected: string,
  allowMissing = false,
): boolean {
  const aud = (payload as { aud?: unknown }).aud;
  if (aud === undefined) return allowMissing;
  if (typeof aud !== "string") return false; // arrays are never legitimate here
  return aud === expected;
}

export function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(session: Session): Promise<string> {
  return await new SignJWT({ s: session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(WEB_AUDIENCE)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    // Reject anything stamped for another audience — notably an iOS import
    // bearer token being replayed as a browser cookie. Legacy cookies carry no
    // `aud` at all, so those are still accepted during the transition window.
    if (!assertExactAudience(payload, WEB_AUDIENCE, true)) {
      return null;
    }
    const s = (payload as { s?: unknown }).s;
    if (!isSession(s)) return null;
    return s;
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: Session): Promise<void> {
  const token = await signSession(session);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionCookie(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifySessionToken(token);
}

export function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.role === "OWNER") {
    return v.actingUserId === undefined || typeof v.actingUserId === "string";
  }
  if (v.role === "USER") {
    return typeof v.userId === "string";
  }
  return false;
}
