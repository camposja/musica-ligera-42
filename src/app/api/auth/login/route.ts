import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (b.type === "OWNER") {
    if (typeof b.username !== "string" || typeof b.password !== "string") {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const envUser = process.env.OWNER_USERNAME;
    const envPass = process.env.OWNER_PASSWORD;
    if (!envUser || !envPass) {
      return Response.json({ error: "Server not configured" }, { status: 500 });
    }
    if (!safeEqual(b.username, envUser) || !safeEqual(b.password, envPass)) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }
    await setSessionCookie({ role: "OWNER" });
    return Response.json({ role: "OWNER" });
  }

  if (b.type === "USER") {
    if (typeof b.name !== "string" || typeof b.accessCode !== "string") {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }
    // Exact-match name lookup. SQLite has no `mode: "insensitive"` at the
    // Prisma layer, so login is case-sensitive — the user must type their
    // name exactly as stored (preserving display casing).
    const user = await prisma.user.findFirst({
      where: { name: b.name.trim() },
    });
    if (
      !user ||
      user.role !== "USER" ||
      !safeEqual(b.accessCode, user.accessCode)
    ) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }
    await setSessionCookie({ role: "USER", userId: user.id });
    return Response.json({ role: "USER", userId: user.id, name: user.name });
  }

  return Response.json({ error: "Invalid type" }, { status: 400 });
}
