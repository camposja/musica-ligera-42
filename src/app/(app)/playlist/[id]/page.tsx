import Link from "next/link";
import { notFound } from "next/navigation";
import { ClonePlaylistButton } from "@/components/ClonePlaylistButton";
import { DeletePlaylistButton } from "@/components/DeletePlaylistButton";
import { getEffectiveUserIdOrNull, getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { normalizeSong } from "@/lib/song-serialization";
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

  // OWNER sees a target picker for cross-profile clone. Filter to USER role
  // only — never expose other OWNERs as a target. Hidden from normal USERs
  // entirely (they don't get the prop).
  const targetUsers =
    session.role === "OWNER"
      ? (
          await prisma.user.findMany({
            where: { role: "USER", id: { not: eid } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        )
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
          ← Back to playlists
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{playlist.name}</h1>
              {playlist.locked && (
                <span
                  title={
                    playlist.sourceLabel ?? "This playlist is a protected import"
                  }
                  className="inline-flex shrink-0 items-center rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent"
                >
                  Locked import
                </span>
              )}
            </div>
            <p className="text-sm text-muted">
              {playlist.songs.length}{" "}
              {playlist.songs.length === 1 ? "song" : "songs"}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <ClonePlaylistButton
              playlistId={playlist.id}
              targetUsers={targetUsers}
            />
            <DeletePlaylistButton playlistId={playlist.id} />
          </div>
        </div>
        {playlist.locked && (
          <p className="mt-2 text-xs text-muted">
            This playlist is a protected import. Clone it to edit.
          </p>
        )}
      </div>
      <SongList
        playlistId={playlist.id}
        locked={playlist.locked}
        role={session.role}
        songs={playlist.songs.map((ps) => ({ order: ps.order, song: normalizeSong(ps.song) }))}
      />
    </div>
  );
}
