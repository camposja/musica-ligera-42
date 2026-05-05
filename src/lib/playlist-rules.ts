export class LockedPlaylistError extends Error {
  constructor() {
    super("Playlist is locked. Clone it to edit.");
    this.name = "LockedPlaylistError";
  }
}

export function assertEditable(playlist: { locked: boolean }): void {
  if (playlist.locked) throw new LockedPlaylistError();
}

export function lockedResponse(): Response {
  return Response.json(
    { error: "Playlist is locked. Clone it to edit." },
    { status: 409 },
  );
}
