"use client";

import { useState } from "react";

type Props = {
  onSearch: (q: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  buttonClassName?: string;
  inputClassName?: string;
  // Optional controlled mode: pass both to let a parent drive the input (e.g. to
  // populate it when a recent search is clicked). Omit both to keep the bar
  // self-contained (its previous, uncontrolled behavior).
  value?: string;
  onChange?: (v: string) => void;
};

const DEFAULT_BUTTON_CLASS =
  "rounded bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50";

const DEFAULT_INPUT_CLASS =
  "flex-1 rounded border border-border bg-background px-3 py-2 outline-none focus:border-accent";

export function SearchBar({
  onSearch,
  disabled,
  placeholder = "Search artists, songs, albums…",
  buttonClassName = DEFAULT_BUTTON_CLASS,
  inputClassName = DEFAULT_INPUT_CLASS,
  value,
  onChange,
}: Props) {
  const [internal, setInternal] = useState("");
  const controlled = value !== undefined;
  const q = controlled ? value : internal;
  const setQ = (v: string) => {
    if (controlled) onChange?.(v);
    else setInternal(v);
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    onSearch(trimmed);
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className={inputClassName}
      />
      <button
        type="submit"
        disabled={disabled || q.trim().length === 0}
        className={buttonClassName}
      >
        {disabled ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
