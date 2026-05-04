import Link from "next/link";
import { notFound } from "next/navigation";
import { getEffectiveUserIdOrNull, getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { SongList } from "@/components/SongList";

type Params = Promise<{ id: string }>;

export default async function PlaylistPage({ params }: { params: Params }) {
  const { id } = await params;
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

  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      songs: {
        orderBy: { order: "asc" },
        include: { song: true },
      },
    },
  });

  if (!playlist || playlist.userId !== eid) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
          ← Back to playlists
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{playlist.name}</h1>
        <p className="text-sm text-muted">
          {playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"}
        </p>
      </div>
      <SongList
        playlistId={playlist.id}
        songs={playlist.songs.map((ps) => ({ order: ps.order, song: ps.song }))}
      />
    </div>
  );
}
