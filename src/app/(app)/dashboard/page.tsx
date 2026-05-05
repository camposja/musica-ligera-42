import { getEffectiveUserIdOrNull, getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { CreatePlaylistForm } from "@/components/CreatePlaylistForm";
import { ImportPlaylistForm } from "@/components/ImportPlaylistForm";
import { PlaylistList } from "@/components/PlaylistList";
import { RefilterYoutubeButton } from "@/components/RefilterYoutubeButton";

type SpotifyBanner = "connected" | "forbidden" | "error";

function spotifyBanner(value: SpotifyBanner) {
  const styles: Record<SpotifyBanner, string> = {
    connected: "border-accent/40 bg-accent/10 text-accent",
    forbidden: "border-border bg-surface text-muted",
    error: "border-danger/40 bg-surface text-danger",
  };
  const messages: Record<SpotifyBanner, string> = {
    connected: "Spotify connected.",
    forbidden: "You cancelled the Spotify connection.",
    error: "Couldn't connect to Spotify. Try again.",
  };
  return (
    <div className={`rounded border px-4 py-3 text-sm ${styles[value]}`}>
      {messages[value]}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const spotifyParam = params.spotify;
  const banner: SpotifyBanner | null =
    spotifyParam === "connected" ||
    spotifyParam === "forbidden" ||
    spotifyParam === "error"
      ? spotifyParam
      : null;

  const session = await getRequiredSession();
  const eid = getEffectiveUserIdOrNull(session);

  if (!eid) {
    return (
      <div className="flex flex-col gap-4">
        {banner && spotifyBanner(banner)}
        <div className="rounded border border-border bg-surface p-6 text-sm">
          <h1 className="mb-2 text-lg font-semibold">Pick a user to start</h1>
          <p className="text-muted">
            As OWNER you don&rsquo;t have your own playlists. Use the user switcher in the
            header to act as a USER, then come back here to manage their playlists.
          </p>
        </div>
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
      {banner && spotifyBanner(banner)}
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
      {session.role === "OWNER" && <RefilterYoutubeButton />}
    </div>
  );
}
