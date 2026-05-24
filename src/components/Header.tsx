"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { UserSwitcher } from "@/components/UserSwitcher";
import { HeaderMenu } from "@/components/HeaderMenu";
import { KeepAliveButton } from "@/components/KeepAliveButton";

type Props = {
  userName?: string;
  actingUserName?: string;
  spotifyConnected: boolean;
  spotifyAccountId: string | null;
  allowChildSpotifyLogin: boolean;
};

export function Header({
  userName,
  actingUserName,
  spotifyConnected,
  spotifyAccountId,
  allowChildSpotifyLogin,
}: Props) {
  const session = useSession();
  const pathname = usePathname();

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname?.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={`rounded px-2 py-1 text-sm transition-colors ${
          active ? "text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4 sm:py-3">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          <span className="hidden sm:inline">Música Ligera 42</span>
          <span className="sm:hidden">ML42</span>
        </Link>
        <nav className="flex items-center gap-1">
          {navLink("/dashboard", "Dashboard")}
          {navLink("/search", "Search")}
          {session.role === "OWNER" && navLink("/settings", "Settings")}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {session.role === "USER" ? (
            <span className="hidden min-w-0 truncate text-sm text-muted sm:inline">
              <span className="hidden md:inline">Signed in as </span>
              <span className="text-foreground">{userName ?? "you"}</span>
            </span>
          ) : (
            <>
              {actingUserName && (
                <span className="hidden min-w-0 truncate text-sm text-muted sm:inline">
                  <span className="hidden md:inline">Acting as </span>
                  <span className="text-foreground">{actingUserName}</span>
                </span>
              )}
              <UserSwitcher currentActingUserId={session.actingUserId} />
            </>
          )}
          <KeepAliveButton />
          <HeaderMenu
            isOwner={session.role === "OWNER"}
            spotifyConnected={spotifyConnected}
            spotifyAccountId={spotifyAccountId}
            allowChildSpotifyLogin={allowChildSpotifyLogin}
          />
        </div>
      </div>
    </header>
  );
}
