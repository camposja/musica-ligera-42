import { getEffectiveUserIdOrNull, getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { CreatePlaylistForm } from "@/components/CreatePlaylistForm";
import { ImportPlaylistForm } from "@/components/ImportPlaylistForm";
import { PlaylistList } from "@/components/PlaylistList";

export default async function DashboardPage() {
  const session = await getRequiredSession();
  const eid = getEffectiveUserIdOrNull(session);

  if (!eid) {
    return (
      <div className="rounded border border-border bg-surface p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Pick a user to start</h1>
        <p className="text-muted">
          As OWNER you don&rsquo;t have your own playlists. Use the user switcher in the
          header to act as a USER, then come back here to manage their playlists.
        </p>
      </div>
    );
  }

  const playlists = await prisma.playlist.findMany({
    where: { userId: eid },
    include: { _count: { select: { songs: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Your playlists</h1>
      <PlaylistList playlists={playlists} />
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded border border-border bg-surface p-4">
          <CreatePlaylistForm />
        </div>
        <div className="rounded border border-border bg-surface p-4">
          <ImportPlaylistForm />
        </div>
      </div>
    </div>
  );
}
