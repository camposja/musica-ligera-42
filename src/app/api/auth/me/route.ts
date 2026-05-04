import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  if (session.role === "USER") {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true },
    });
    if (!user) return unauthorized();
    return Response.json({ role: "USER", userId: user.id, name: user.name });
  }

  if (session.actingUserId) {
    const acting = await prisma.user.findUnique({
      where: { id: session.actingUserId },
      select: { id: true, name: true },
    });
    if (!acting) {
      return Response.json({ role: "OWNER" });
    }
    return Response.json({
      role: "OWNER",
      actingUserId: acting.id,
      actingUserName: acting.name,
    });
  }
  return Response.json({ role: "OWNER" });
}
