import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeSong, serializeAltIds } from "@/lib/song-serialization";
import {
  fetchVideoDetails,
  isValidYoutubeId,
  parseYoutubeRef,
  YoutubeError,
} from "@/lib/youtube";

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
  const b = body as Record<string, unknown>;
  if (typeof b.songId !== "string" || b.songId.length === 0) {
    return Response.json({ error: "songId required" }, { status: 400 });
  }

  // Accept either a raw id or a YouTube URL. youtubeUrl wins if both present —
  // it's the more specific signal (someone pasted a link).
  //
  // Each error response carries a stable `code` so the client can map to
  // friendly per-case copy without parsing the human-readable `error` string.
  let videoId: string | null = null;
  if (typeof b.youtubeUrl === "string" && b.youtubeUrl.length > 0) {
    videoId = parseYoutubeRef(b.youtubeUrl);
    if (!videoId) {
      return Response.json(
        {
          code: "parse_failed",
          error: "Could not parse a YouTube video id from youtubeUrl",
        },
        { status: 400 },
      );
    }
  } else if (typeof b.newYoutubeId === "string" && b.newYoutubeId.length > 0) {
    // Also pass through parseYoutubeRef so a pasted URL in this field still works.
    videoId = parseYoutubeRef(b.newYoutubeId);
    if (!videoId || !isValidYoutubeId(videoId)) {
      return Response.json(
        {
          code: "parse_failed",
          error: "newYoutubeId must be an 11-character YouTube id",
        },
        { status: 400 },
      );
    }
  } else {
    return Response.json(
      {
        code: "parse_failed",
        error: "youtubeUrl or newYoutubeId required",
      },
      { status: 400 },
    );
  }

  const exists = await prisma.song.findUnique({
    where: { id: b.songId },
    select: { id: true },
  });
  if (!exists) {
    return Response.json({ error: "Song not found" }, { status: 404 });
  }

  // Validate the pasted video actually exists and is playable. Cheap (3 quota
  // units) and prevents typos / dead links from being persisted forever.
  let details;
  try {
    details = await fetchVideoDetails([videoId]);
  } catch (err) {
    if (err instanceof YoutubeError && err.httpStatus === 0) {
      return Response.json(
        { code: "upstream_unreachable", error: err.message },
        { status: 502 },
      );
    }
    return Response.json(
      { code: "upstream_unreachable", error: "YouTube validation failed" },
      { status: 502 },
    );
  }
  const d = details.get(videoId);
  if (!d) {
    return Response.json(
      {
        code: "not_found",
        error: "YouTube video not found or unavailable",
      },
      { status: 400 },
    );
  }
  if (d.isPrivate) {
    return Response.json(
      { code: "private", error: "YouTube video is private" },
      { status: 400 },
    );
  }

  // Populate match metadata from the validation call so the badge tooltip
  // ("Manual match: <title> by <channel>") is informative.
  const updated = await prisma.song.update({
    where: { id: b.songId },
    data: {
      youtubeId: videoId,
      youtubeAltIdsJson: serializeAltIds([]),
      youtubeMatchType: "loose",
      youtubeMatchReason: "manual",
      youtubeMatchTitle: d.title || null,
      youtubeMatchChannel: d.channel || null,
    },
  });
  return Response.json({ song: normalizeSong(updated) });
}
