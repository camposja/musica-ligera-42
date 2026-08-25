import { getIosSession, iosError, iosJson } from "@/lib/ios-auth";
import { featureDisabled, isIosImportEnabled } from "@/lib/ios-flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/// OWNER-only account picker. A USER has exactly one library and never needs
/// this, so it is forbidden rather than filtered — mirroring the existing
/// OWNER-gated `/api/users`.
export async function GET(request: Request) {
  if (!isIosImportEnabled()) return featureDisabled();

  const session = await getIosSession(request);
  if (!session) return iosError("Unauthorized", 401);
  if (session.role !== "OWNER") return iosError("Forbidden", 403);

  const users = await prisma.user.findMany({
    where: { role: "USER" },
    select: {
      id: true,
      name: true,
      _count: { select: { playlists: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return iosJson({
    accounts: users.map((u) => ({
      id: u.id,
      name: u.name,
      playlistCount: u._count.playlists,
    })),
  });
}
