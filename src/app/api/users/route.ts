import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      role: true,
      spotifyUserId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ users });
}
