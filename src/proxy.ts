import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dev-only: redirect localhost (and IPv6 [::1]) to 127.0.0.1 so cookies,
// session, and the Spotify OAuth redirect URI all line up on one canonical
// host. No-op in production. Uses 307 (not 308) so browsers don't cache the
// redirect — easy to disable by editing this file without leaving stale
// permanent redirects in users' browsers.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return;
  const host = request.headers.get("host") ?? "";
  if (
    !host.startsWith("localhost") &&
    !host.startsWith("[::1]") &&
    !host.startsWith("0.0.0.0")
  ) {
    return;
  }
  // Build the target URL fresh from request.url to avoid any NextURL quirks
  // around hostname mutation in dev.
  const original = new URL(request.url);
  const port = original.port || "3000";
  const target = `http://127.0.0.1:${port}${original.pathname}${original.search}`;
  return NextResponse.redirect(target, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
