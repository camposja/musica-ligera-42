/// Fixed-window attempt throttle for credential endpoints.
///
/// The repo had no rate limiting at all before this; the only throttle anywhere
/// was the YouTube daily quota ledger. A public credential endpoint can't ship
/// without one, so this covers BOTH `POST /api/ios/auth` and the pre-existing
/// `POST /api/auth/login`.
///
/// In-memory is adequate and honest here: Fly runs a single machine
/// (`min_machines_running = 0`, deploy strategy `immediate` precisely so two
/// machines never contend for the SQLite volume), so there is no second process
/// to share state with. The counter DOES reset on cold start — stated plainly
/// rather than hidden, since auto-stop makes that a routine event.
export const IP_LIMIT = 10;
export const IDENTITY_LIMIT = 5;
export const WINDOW_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type ThrottleResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function hit(key: string, limit: number, now: number): ThrottleResult {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true };
}

/// Resolve the client IP without trusting attacker-controlled input.
///
/// Taking `x-forwarded-for`'s FIRST value is the classic mistake: a client can
/// send its own `X-Forwarded-For`, and a proxy that appends leaves the spoofed
/// value in front — so IP throttling keyed on it is bypassed by varying one
/// header. Fly's proxy sets `Fly-Client-IP` with the true peer address and
/// appends the real address to `X-Forwarded-For`, so we prefer the former and
/// otherwise take the LAST XFF entry. If neither is present we return null and
/// fall back to identity-only throttling rather than keying on a spoofable value.
export function clientIpFrom(request: Request): string | null {
  const flyIp = request.headers.get("fly-client-ip");
  if (flyIp && flyIp.trim()) return flyIp.trim();

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return null;
}

/// Counts one attempt against both the IP and identity buckets. Whichever trips
/// first wins. Identity is the load-bearing half — it works even when no
/// trustworthy IP header is present.
export function recordAttempt(opts: {
  ip: string | null;
  identity: string | null;
  now?: number;
}): ThrottleResult {
  const now = opts.now ?? Date.now();
  const results: ThrottleResult[] = [];
  if (opts.ip) results.push(hit(`ip:${opts.ip}`, IP_LIMIT, now));
  if (opts.identity) results.push(hit(`id:${opts.identity}`, IDENTITY_LIMIT, now));

  for (const r of results) {
    if (!r.allowed) return r;
  }
  return { allowed: true };
}

/// Clears an identity's bucket after a SUCCESSFUL authentication.
///
/// Without this the throttle counts successes too, so a legitimate user signing
/// in a sixth time within the window — several devices, a cleared cookie jar, a
/// re-install — would be locked out for no reason. Resetting on success costs
/// nothing defensively: an attacker who has already guessed the right secret
/// has won regardless of what the counter says. The IP bucket is deliberately
/// NOT cleared, so one host cannot launder unlimited attempts across many
/// identities by getting one of them right.
export function clearIdentityOnSuccess(identity: string | null): void {
  if (identity) buckets.delete(`id:${identity}`);
}

export function throttled(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many attempts", code: "throttled" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

/// Deterministic reset for tests. Without this the 429 test poisons every later
/// login test in the same file, since the bucket map is module-level state.
export function __resetThrottleForTests(): void {
  buckets.clear();
}
