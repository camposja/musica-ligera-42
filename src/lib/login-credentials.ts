import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/session";

/// Constant-time compare over SHA-256 digests, so inputs of differing length
/// don't throw and the comparison doesn't leak length via timing.
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export type CredentialResult =
  | { ok: true; session: Session; userName?: string; userId?: string }
  | { ok: false; reason: "invalid_body" | "invalid_type" | "invalid_credentials" | "not_configured" };

/// Single source of truth for credential verification, shared by the browser
/// login route (which sets a cookie) and the iOS auth route (which mints a
/// bearer token). Extracted so the timing-safe compare exists in exactly one
/// place — two copies would inevitably drift.
///
/// Deliberately returns a `Session` and nothing else: it does not set cookies,
/// mint tokens, or touch `next/headers`. That keeps it callable from both
/// transports and trivially unit-testable.
export async function authenticateCredentials(
  body: unknown,
): Promise<CredentialResult> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (b.type === "OWNER") {
    if (typeof b.username !== "string" || typeof b.password !== "string") {
      return { ok: false, reason: "invalid_credentials" };
    }
    const envUser = process.env.OWNER_USERNAME;
    const envPass = process.env.OWNER_PASSWORD;
    if (!envUser || !envPass) return { ok: false, reason: "not_configured" };
    if (!safeEqual(b.username, envUser) || !safeEqual(b.password, envPass)) {
      return { ok: false, reason: "invalid_credentials" };
    }
    return { ok: true, session: { role: "OWNER" } };
  }

  if (b.type === "USER") {
    if (typeof b.name !== "string" || typeof b.accessCode !== "string") {
      return { ok: false, reason: "invalid_credentials" };
    }
    // Case-insensitive name lookup against mixed-case stored names. SQLite has
    // no `mode: "insensitive"` at the Prisma layer, so we fetch USERs and do the
    // lowercase compare in JS. Trivial cost on a small user set.
    const target = b.name.trim().toLowerCase();
    const candidates = await prisma.user.findMany({ where: { role: "USER" } });
    const user = candidates.find((u) => u.name.toLowerCase() === target) ?? null;
    if (!user || user.role !== "USER" || !safeEqual(b.accessCode, user.accessCode)) {
      return { ok: false, reason: "invalid_credentials" };
    }
    return {
      ok: true,
      session: { role: "USER", userId: user.id },
      userId: user.id,
      userName: user.name,
    };
  }

  return { ok: false, reason: "invalid_type" };
}

/// Stable throttle key for an attempt, so repeated guesses against one identity
/// are counted together regardless of source IP. Never includes the secret.
export function identityKeyFor(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.type === "OWNER") return "owner";
  if (b.type === "USER" && typeof b.name === "string") {
    return `user:${b.name.trim().toLowerCase()}`;
  }
  return null;
}
