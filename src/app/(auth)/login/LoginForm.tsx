"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "OWNER" | "USER";

export default function LoginForm({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [field1, setField1] = useState("");
  const [field2, setField2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setField1("");
    setField2("");
    setError(null);
    setRevealed(false);
  }

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

  const inputClass =
    "rounded border border-border bg-background px-3 py-2 outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex justify-end">
          <LogoMark className="-translate-x-2" />
        </div>
        <span className="px-4 text-[1.625rem] font-semibold tracking-tight whitespace-nowrap">
          Musica Ligera
          {mode === "USER" && (
            /*
              Hidden OWNER trigger. The accessible OWNER entrypoint is
              /login?owner=1 — this dot is a visual easter egg only, hidden
              from assistive tech via aria-hidden + tabIndex={-1}. Keyboard
              and screen-reader users get the documented URL path.
            */
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => switchMode("OWNER")}
              className="ml-0.5 inline-flex h-7 w-7 items-center justify-center align-middle"
            >
              <span className="block h-1.5 w-1.5 rounded-full bg-muted/40 hover:bg-muted" />
            </button>
          )}
        </span>
        <div aria-hidden="true" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
          <div className="relative">
            <input
              type={revealed ? "text" : "password"}
              autoComplete="current-password"
              value={field2}
              onChange={(e) => setField2(e.target.value)}
              className={`${inputClass} w-full pr-10`}
              required
            />
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-foreground"
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
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

      {mode === "OWNER" && (
        <div className="text-xs text-muted">
          <button
            type="button"
            onClick={() => {
              switchMode("USER");
              router.replace("/login");
            }}
            className="underline-offset-2 hover:underline"
          >
            User sign in
          </button>
        </div>
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="72"
      height="72"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="14" stroke="var(--accent)" strokeWidth="2" />
      <polygon
        points="16,6 24.5,12.2 21.3,22.2 10.7,22.2 7.5,12.2"
        stroke="var(--accent)"
        strokeWidth="1.5"
        fill="none"
      />
      <polygon points="13,12 13,20 21,16" fill="var(--accent)" />
    </svg>
  );
}
