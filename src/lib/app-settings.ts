import { prisma } from "@/lib/prisma";

export type AppSettings = {
  allowChildSpotifyLogin: boolean;
};

// Upsert-on-read so callers never have to handle a missing singleton row.
// The defaults live in the Prisma schema (`@default(false)` etc.) — keeping
// them there means new boolean columns Just Work without code edits here.
export async function getAppSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
    select: { allowChildSpotifyLogin: true },
  });
  return { allowChildSpotifyLogin: row.allowChildSpotifyLogin };
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const row = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...patch },
    update: patch,
    select: { allowChildSpotifyLogin: true },
  });
  return { allowChildSpotifyLogin: row.allowChildSpotifyLogin };
}
