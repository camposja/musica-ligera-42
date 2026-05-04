"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "OWNER" | "USER";

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("USER");
  const [field1, setField1] = useState(""); // username (OWNER) or name (USER)
  const [field2, setField2] = useState(""); // password (OWNER) or accessCode (USER)
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const body =
      mode === "OWNER"
        ? { type: "OWNER", username: field1, password: field2 }
        : { type: "USER", name: field1, accessCode: field2 };

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Login failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("USER")}
          className={`flex-1 rounded border px-3 py-1.5 ${
            mode === "USER"
              ? "border-black bg-black text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          User
        </button>
        <button
          type="button"
          onClick={() => setMode("OWNER")}
          className={`flex-1 rounded border px-3 py-1.5 ${
            mode === "OWNER"
              ? "border-black bg-black text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          Owner
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>{mode === "OWNER" ? "Username" : "Name"}</span>
        <input
          type="text"
          autoComplete="username"
          value={field1}
          onChange={(e) => setField1(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{mode === "OWNER" ? "Password" : "Access code"}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={field2}
          onChange={(e) => setField2(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          required
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
