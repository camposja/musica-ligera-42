"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "OWNER" | "USER";

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("USER");
  const [field1, setField1] = useState("");
  const [field2, setField2] = useState("");
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

  const tabBase = "flex-1 rounded border px-3 py-1.5 transition-colors";
  const tabActive = "border-accent bg-accent text-accent-foreground";
  const tabIdle = "border-border text-muted hover:text-foreground";
  const inputClass =
    "rounded border border-border bg-background px-3 py-2 outline-none focus:border-accent";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("USER")}
          className={`${tabBase} ${mode === "USER" ? tabActive : tabIdle}`}
        >
          User
        </button>
        <button
          type="button"
          onClick={() => setMode("OWNER")}
          className={`${tabBase} ${mode === "OWNER" ? tabActive : tabIdle}`}
        >
          Owner
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{mode === "OWNER" ? "Username" : "Name"}</span>
        <input
          type="text"
          autoComplete="username"
          value={field1}
          onChange={(e) => setField1(e.target.value)}
          className={inputClass}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{mode === "OWNER" ? "Password" : "Access code"}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={field2}
          onChange={(e) => setField2(e.target.value)}
          className={inputClass}
          required
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
