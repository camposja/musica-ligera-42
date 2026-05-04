import { getEffectiveUserIdOrNull, getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { SearchPageClient } from "./SearchPageClient";

export default async function SearchPage() {
  const session = await getRequiredSession();
  const eid = getEffectiveUserIdOrNull(session);

  if (!eid) {
    return (
      <div className="rounded border border-border bg-surface p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Pick a user to start</h1>
        <p className="text-muted">
          Use the user switcher in the header to act as a USER first.
        </p>
      </div>
    );
  }

  const playlists = await prisma.playlist.findMany({
    where: { userId: eid },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return <SearchPageClient playlists={playlists} />;
}
