import { vi } from "vitest";

const mockCookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => mockCookieStore.get(name),
    set: (name: string, value: string) =>
      mockCookieStore.set(name, { name, value }),
    delete: (name: string) => mockCookieStore.delete(name),
  }),
}));

import { signSession, type Session } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export { prisma };

export function clearCookies(): void {
  mockCookieStore.clear();
}

export async function setSession(session: Session): Promise<void> {
  const token = await signSession(session);
  mockCookieStore.set("ml42_session", { name: "ml42_session", value: token });
}

export async function setOwnerSession(): Promise<void> {
  await setSession({ role: "OWNER" });
}

export async function setOwnerActingSession(userId: string): Promise<void> {
  await setSession({ role: "OWNER", actingUserId: userId });
}

export async function setUserSession(userId: string): Promise<void> {
  await setSession({ role: "USER", userId });
}

export async function truncateAll(): Promise<void> {
  // SQLite has no TRUNCATE. DELETE FROM in FK-respecting order works:
  // children first (PlaylistSong → Playlist → Song → User), then unrelated
  // SpotifyConnection.
  await prisma.$transaction([
    prisma.playlistSong.deleteMany({}),
    prisma.playlist.deleteMany({}),
    prisma.song.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.spotifyConnection.deleteMany({}),
    prisma.apiQuotaUsage.deleteMany({}),
    prisma.youtubeSearchCache.deleteMany({}),
  ]);
}

export async function seedSpotifyConnection(opts?: {
  expiresAt?: Date;
  accessToken?: string;
  refreshToken?: string;
}): Promise<void> {
  await prisma.spotifyConnection.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      accessToken: opts?.accessToken ?? "test_access_token",
      refreshToken: opts?.refreshToken ?? "test_refresh_token",
      expiresAt: opts?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      scope: "playlist-read-private playlist-read-collaborative",
      spotifyUserId: "test_spotify_user",
    },
    update: {
      accessToken: opts?.accessToken ?? "test_access_token",
      refreshToken: opts?.refreshToken ?? "test_refresh_token",
      expiresAt: opts?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

export function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function emptyRequest(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

type ParamCtx<T extends Record<string, string>> = { params: Promise<T> };

export function ctx<T extends Record<string, string>>(params: T): ParamCtx<T> {
  return { params: Promise.resolve(params) };
}
