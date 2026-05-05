import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dev-only: redirect localhost (and IPv6 [::1]) to 127.0.0.1 so cookies,
// session, and the Spotify OAuth redirect URI all line up on one canonical
// host. No-op in production.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return;
  const host = request.headers.get("host") ?? "";
  if (!host.startsWith("localhost") && !host.startsWith("[::1]")) return;
  const url = request.nextUrl.clone();
  url.hostname = "127.0.0.1";
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
