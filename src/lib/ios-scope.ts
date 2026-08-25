import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/session";

export type ExportScope =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 403; code: "account_required" | "forbidden" };

/// The single place export authorization is decided, for every `/api/ios/*`
/// route that reads library data.
///
/// A USER passing someone else's `userId` gets 403 rather than a silent
/// fallback to their own id: a silent correction hides a client bug and reads
/// as success. A bare OWNER session has no effective user (mirroring
/// `effectiveUserId()` returning null), so it must name an account explicitly.
export async function resolveExportScope(
  session: Session,
  requestedUserId?: string | null,
): Promise<ExportScope> {
  const requested = requestedUserId?.trim() || undefined;

  if (session.role === "USER") {
    if (requested && requested !== session.userId) {
      return { ok: false, status: 403, code: "forbidden" };
    }
    return { ok: true, userId: session.userId };
  }

  // OWNER
  if (!requested) return { ok: false, status: 400, code: "account_required" };

  const target = await prisma.user.findUnique({
    where: { id: requested },
    select: { id: true, role: true },
  });
  // Non-existent and non-USER collapse to the same 403 so the endpoint can't be
  // used to enumerate which ids exist.
  if (!target || target.role !== "USER") {
    return { ok: false, status: 403, code: "forbidden" };
  }
  return { ok: true, userId: target.id };
}
