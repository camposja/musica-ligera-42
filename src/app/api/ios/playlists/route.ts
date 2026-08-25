import { getIosSession, iosError, iosJson } from "@/lib/ios-auth";
import { featureDisabled, isIosImportEnabled } from "@/lib/ios-flag";
import { resolveExportScope } from "@/lib/ios-scope";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/// Picker + preview feed. Returns counts only — never song rows — so the
/// preview screen ("N playlists · M songs · K matched") is honest without
/// downloading the library first.
export async function GET(request: Request) {
  if (!isIosImportEnabled()) return featureDisabled();

  const session = await getIosSession(request);
  if (!session) return iosError("Unauthorized", 401);

  const url = new URL(request.url);
  const scope = await resolveExportScope(session, url.searchParams.get("userId"));
  if (!scope.ok) {
    return iosError(
      scope.code === "forbidden" ? "Forbidden" : "Account required",
      scope.status,
      scope.code,
    );
  }

  const account = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: { id: true, name: true },
  });
  if (!account) return iosError("Forbidden", 403, "forbidden");

  const playlists = await prisma.playlist.findMany({
    where: { userId: scope.userId },
    select: {
      id: true,
      name: true,
      source: true,
      sourceLabel: true,
      createdAt: true,
      _count: { select: { songs: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // `matchedCount` = songs with a resolved YouTube id. Computed per playlist in
  // one grouped query rather than N queries, then joined in memory.
  const matched = await prisma.playlistSong.groupBy({
    by: ["playlistId"],
    where: {
      playlist: { userId: scope.userId },
      song: { youtubeId: { not: null } },
    },
    _count: { _all: true },
  });
  const matchedByPlaylist = new Map(
    matched.map((m) => [m.playlistId, m._count._all]),
  );

  return iosJson({
    account,
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      sourceLabel: p.sourceLabel,
      createdAt: p.createdAt,
      songCount: p._count.songs,
      matchedCount: matchedByPlaylist.get(p.id) ?? 0,
    })),
  });
}
