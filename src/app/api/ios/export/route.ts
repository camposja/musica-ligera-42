import { getIosSession, iosError, iosJson, NO_STORE } from "@/lib/ios-auth";
import {
  checkEncodedSize,
  checkMembershipCount,
  checkPlaylistCount,
  type LimitBreach,
} from "@/lib/ios-export-limits";
import { featureDisabled, isIosImportEnabled } from "@/lib/ios-flag";
import { resolveExportScope } from "@/lib/ios-scope";
import { prisma } from "@/lib/prisma";
import { normalizeSong } from "@/lib/song-serialization";

export const dynamic = "force-dynamic";

export const EXPORT_SCHEMA_VERSION = 1;

function tooLarge(breach: LimitBreach): Response {
  return Response.json(
    {
      error: "Export too large",
      code: "export_too_large",
      limit: breach.limit,
      max: breach.max,
      actual: breach.actual,
    },
    { status: 400, headers: NO_STORE },
  );
}

/// The payload iOS imports. POST rather than GET so a 50-playlist selection
/// can't blow the URL length limit.
export async function POST(request: Request) {
  if (!isIosImportEnabled()) return featureDisabled();

  const session = await getIosSession(request);
  if (!session) return iosError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return iosError("Invalid JSON", 400);
  }
  if (typeof body !== "object" || body === null) {
    return iosError("Invalid body", 400);
  }
  const b = body as Record<string, unknown>;

  if (
    !Array.isArray(b.playlistIds) ||
    !b.playlistIds.every((id): id is string => typeof id === "string")
  ) {
    return iosError("playlistIds must be an array of strings", 400);
  }
  const playlistIds = b.playlistIds as string[];
  if (playlistIds.length === 0) {
    return iosError("playlistIds must not be empty", 400);
  }

  // Duplicates are rejected, not silently deduped. A silent fix hides a client
  // bug, and this API already refuses to quietly correct a USER who names
  // someone else's account. Left unhandled, duplicates would also inflate the
  // limit checks and hand iOS two identical playlists to merge twice.
  if (new Set(playlistIds).size !== playlistIds.length) {
    return iosError("Duplicate playlistIds", 400, "duplicate_playlist_ids");
  }

  const userIdParam = typeof b.userId === "string" ? b.userId : undefined;
  const scope = await resolveExportScope(session, userIdParam);
  if (!scope.ok) {
    return iosError(
      scope.code === "forbidden" ? "Forbidden" : "Account required",
      scope.status,
      scope.code,
    );
  }

  const countBreach = checkPlaylistCount(playlistIds.length);
  if (countBreach) return tooLarge(countBreach);

  const account = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: { id: true, name: true },
  });
  if (!account) return iosError("Forbidden", 403, "forbidden");

  // Ownership: every requested playlist must belong to the scoped account.
  // Anything else is 403 — not a filtered-down 200 — so a client asking for a
  // playlist it may not have finds out.
  const owned = await prisma.playlist.findMany({
    where: { id: { in: playlistIds }, userId: scope.userId },
    select: { id: true },
  });
  if (owned.length !== playlistIds.length) {
    return iosError("Forbidden", 403, "forbidden");
  }

  const membershipCount = await prisma.playlistSong.count({
    where: { playlistId: { in: playlistIds } },
  });
  const membershipBreach = checkMembershipCount(membershipCount);
  if (membershipBreach) return tooLarge(membershipBreach);

  const rows = await prisma.playlist.findMany({
    where: { id: { in: playlistIds }, userId: scope.userId },
    select: {
      id: true,
      name: true,
      source: true,
      sourceLabel: true,
      locked: true,
      importedAt: true,
      createdAt: true,
      songs: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          song: {
            select: {
              id: true,
              title: true,
              artist: true,
              album: true,
              spotifyId: true,
              youtubeId: true,
              youtubeAltIdsJson: true,
              youtubeMatchType: true,
              youtubeMatchReason: true,
              youtubeMatchTitle: true,
              youtubeMatchChannel: true,
              youtubeDurationSeconds: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const payload = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    account,
    playlists: rows.map((p) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      sourceLabel: p.sourceLabel,
      locked: p.locked,
      importedAt: p.importedAt,
      createdAt: p.createdAt,
      // `order` is emitted explicitly so iOS never has to trust array position.
      // Songs go through `normalizeSong` so `youtubeAltIdsJson` never reaches
      // the wire — see the convention in song-serialization.ts.
      songs: p.songs.map((ps) => ({ ...normalizeSong(ps.song), order: ps.order })),
    })),
  };

  // Size is checked on the encoded document, before responding. Reject whole
  // rather than truncate: iOS decodes and writes this in one transaction, so a
  // partial body would commit as a successful-looking partial import.
  const encoded = JSON.stringify(payload);
  const sizeBreach = checkEncodedSize(Buffer.byteLength(encoded, "utf8"));
  if (sizeBreach) return tooLarge(sizeBreach);

  return new Response(encoded, {
    status: 200,
    headers: { ...NO_STORE, "Content-Type": "application/json" },
  });
}
