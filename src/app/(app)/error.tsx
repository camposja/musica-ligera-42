"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded border border-danger/40 bg-surface p-6">
      <h2 className="mb-2 text-lg font-semibold text-danger">Something went wrong</h2>
      <p className="mb-4 text-sm text-muted">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
      >
        Try again
      </button>
    </div>
  );
}
