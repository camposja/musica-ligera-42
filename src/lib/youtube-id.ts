/**
 * Single source of truth for the YouTube video-id format. Kept in its own
 * tiny module so client components, server routes, and pure helpers can all
 * import the same regex without dragging in Prisma or React.
 */

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isValidYoutubeId(id: unknown): id is string {
  return typeof id === "string" && YOUTUBE_ID_RE.test(id);
}
