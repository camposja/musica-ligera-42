import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const userId = (body as Record<string, unknown>).userId;
  if (typeof userId !== "string" || userId.length === 0) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });

  if (!target || target.role !== "USER") {
    return Response.json(
      { error: "Target user not found or not a USER" },
      { status: 400 },
    );
  }

  await setSessionCookie({ role: "OWNER", actingUserId: target.id });
  return Response.json({
    role: "OWNER",
    actingUserId: target.id,
    actingUserName: target.name,
  });
}
