"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useSession } from "@/components/SessionProvider";
import { UserSwitcher } from "@/components/UserSwitcher";

type Props = { userName?: string; actingUserName?: string };

export function Header({ userName, actingUserName }: Props) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      setSigningOut(false);
      console.error(err instanceof ApiError ? err.message : err);
    }
  }

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
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Música Ligera 42
        </Link>
        <nav className="flex items-center gap-1">
          {navLink("/dashboard", "Dashboard")}
          {navLink("/search", "Search")}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session.role === "USER" ? (
            <span className="text-sm text-muted">
              Signed in as <span className="text-foreground">{userName ?? "you"}</span>
            </span>
          ) : (
            <>
              <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                OWNER
              </span>
              {actingUserName ? (
                <span className="text-sm text-muted">
                  Acting as <span className="text-foreground">{actingUserName}</span>
                </span>
              ) : (
                <span className="text-sm text-muted">Not acting</span>
              )}
              <UserSwitcher currentActingUserId={session.actingUserId} />
            </>
          )}
          <button
            type="button"
            onClick={logout}
            disabled={signingOut}
            className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
