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
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Song", "Playlist", "PlaylistSong" RESTART IDENTITY CASCADE`,
  );
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
