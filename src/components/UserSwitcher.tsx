"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ListUsersResponse, User } from "@/types/api";

type Props = { currentActingUserId?: string };

export function UserSwitcher({ currentActingUserId }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    apiFetch<ListUsersResponse>("/api/users")
      .then((r) => setUsers(r.users))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const userId = e.target.value;
    if (!userId) return;
    setSwitching(true);
    setError(null);
    try {
      await apiFetch("/api/auth/switch-user", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Switch failed");
    } finally {
      setSwitching(false);
    }
  }

  if (loading) {
    return <span className="text-xs text-muted">Loading users…</span>;
  }
  if (error) {
    return <span className="text-xs text-danger">{error}</span>;
  }

  return (
    <select
      value={currentActingUserId ?? ""}
      onChange={onChange}
      disabled={switching}
      className="max-w-[8rem] rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent sm:max-w-none"
    >
      <option value="" disabled>
        Pick a user…
      </option>
      {users
        .filter((u) => u.role === "USER")
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
    </select>
  );
}
