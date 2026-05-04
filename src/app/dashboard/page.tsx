import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import LogoutButton from "./LogoutButton";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  let display: Record<string, unknown>;
  if (session.role === "USER") {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true },
    });
    display = user
      ? { role: "USER", userId: user.id, name: user.name }
      : { role: "USER", userId: session.userId, error: "user not found" };
  } else if (session.actingUserId) {
    const acting = await prisma.user.findUnique({
      where: { id: session.actingUserId },
      select: { id: true, name: true },
    });
    display = acting
      ? {
          role: "OWNER",
          actingUserId: acting.id,
          actingUserName: acting.name,
        }
      : { role: "OWNER", actingUserId: session.actingUserId };
  } else {
    display = { role: "OWNER" };
  }

  return (
    <main className="flex min-h-screen flex-col items-start gap-6 bg-zinc-50 p-8 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Dashboard
      </h1>
      <section className="w-full max-w-xl">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Current session
        </h2>
        <pre className="overflow-auto rounded border border-zinc-300 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {JSON.stringify(display, null, 2)}
        </pre>
      </section>
      <LogoutButton />
    </main>
  );
}
