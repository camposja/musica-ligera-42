import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/session";

// Whether a session may mutate a song's YouTube match. Songs are global shared
// state, so a USER may only repair a song that appears in at least one playlist
// they own; OWNER may repair any song. This is a per-feature authorization check
// only — it does not touch the auth/role model. Call it after confirming the
// song exists so a missing song still reads as 404, not 403.
export async function canRepairSongMatch(
  session: Session,
  songId: string,
): Promise<boolean> {
  if (session.role === "OWNER") return true;
  const owned = await prisma.playlistSong.findFirst({
    where: { songId, playlist: { userId: session.userId } },
    select: { id: true },
  });
  return owned !== null;
}
