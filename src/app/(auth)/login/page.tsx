import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Musica Ligera — Sign in",
};

type Search = { owner?: string };

// Server component reads `?owner=1` (or any truthy value) from the URL and
// passes the initial mode to the client form. Doing this server-side avoids
// the SSR flicker that would happen if the client component used
// useSearchParams to flip mode after mount.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const initialMode = isTruthy(params.owner) ? "OWNER" : "USER";
  return <LoginForm initialMode={initialMode} />;
}

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "owner";
}
