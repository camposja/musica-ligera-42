import Link from "next/link";
import type { PlaylistWithCount } from "@/types/api";

type Props = { playlists: PlaylistWithCount[] };

export function PlaylistList({ playlists }: Props) {
  if (playlists.length === 0) {
    return (
      <p className="rounded border border-border bg-surface p-6 text-sm text-muted">
        No playlists yet. Create one below or import from Spotify.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {playlists.map((p) => (
        <li key={p.id}>
          <Link
            href={`/playlist/${p.id}`}
            className="block rounded border border-border bg-surface px-4 py-3 transition-colors hover:border-accent"
          >
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted">
              {p._count.songs} {p._count.songs === 1 ? "song" : "songs"}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
