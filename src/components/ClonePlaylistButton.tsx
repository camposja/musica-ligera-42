"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; targetName: string | null }
  | { kind: "error"; message: string };

type UserOption = { id: string; name: string };

type Props = {
  playlistId: string;
  // When provided, this is OWNER mode: they can pick a target USER profile.
  // Undefined for normal USER (always clones into self).
  targetUsers?: UserOption[];
};

export function ClonePlaylistButton({ playlistId, targetUsers }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [targetUserId, setTargetUserId] = useState<string>("");

  const isOwnerMode = targetUsers !== undefined;
  const isCrossProfile = isOwnerMode && targetUserId !== "";

  async function clone() {
    setStatus({ kind: "saving" });
    try {
      const body = isCrossProfile ? { targetUserId } : {};
      const res = await apiFetch<{ playlist: { id: string } }>(
        `/api/playlists/${playlistId}/clone`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (isCrossProfile) {
        const target = targetUsers!.find((u) => u.id === targetUserId) ?? null;
        setStatus({ kind: "ok", targetName: target?.name ?? null });
        setTargetUserId("");
      } else {
        // Same-user clone: navigate into the editable copy.
        router.push(`/playlist/${res.playlist.id}`);
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Clone failed",
      });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {isOwnerMode && (
          <select
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            disabled={status.kind === "saving"}
            className="rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-accent sm:text-sm"
            aria-label="Clone target user"
          >
            <option value="">Clone to my view…</option>
            {targetUsers!.map((u) => (
              <option key={u.id} value={u.id}>
                Clone to {u.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={clone}
          disabled={status.kind === "saving"}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-50 sm:text-sm"
        >
          {status.kind === "saving" ? "Cloning…" : "Clone"}
        </button>
      </div>
      {status.kind === "ok" && (
        <span className="text-xs text-accent">
          {status.targetName
            ? `Cloned to ${status.targetName}`
            : "Cloned"}
        </span>
      )}
      {status.kind === "error" && (
        <span className="text-xs text-danger">{status.message}</span>
      )}
    </div>
  );
}
