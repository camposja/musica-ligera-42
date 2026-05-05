import { getRequiredSession } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { SessionProvider } from "@/components/SessionProvider";
import { PlayerProvider } from "@/components/PlayerProvider";
import { Header } from "@/components/Header";
import { PlayerBar } from "@/components/PlayerBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getRequiredSession();

  let userName: string | undefined;
  let actingUserName: string | undefined;

  if (session.role === "USER") {
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });
    userName = u?.name;
  } else if (session.actingUserId) {
    const u = await prisma.user.findUnique({
      where: { id: session.actingUserId },
      select: { name: true },
    });
    actingUserName = u?.name;
  }

  const spotifyConn = await prisma.spotifyConnection.findUnique({
    where: { id: "singleton" },
    select: { spotifyUserId: true },
  });

  return (
    <SessionProvider session={session}>
      <PlayerProvider>
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-30">
            <Header
              userName={userName}
              actingUserName={actingUserName}
              spotifyConnected={!!spotifyConn}
              spotifyAccountId={spotifyConn?.spotifyUserId ?? null}
            />
            <PlayerBar />
          </div>
          <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-4 sm:py-6">{children}</main>
        </div>
      </PlayerProvider>
    </SessionProvider>
  );
}
