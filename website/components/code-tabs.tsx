"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const CHANGE_EVENT = "daloy:code-tabs-change";

function read(storageKey: string, labels: readonly string[]): string {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value && labels.includes(value) ? value : labels[0]!;
  } catch {
    return labels[0]!;
  }
}

/** Props accepted by {@link CodeTabs}. */
export interface CodeTabsProps {
  /** Tab labels, in order; the first is the default and the markdown export. */
  labels: readonly string[];
  /** Pre-rendered panels (usually server-highlighted `CodeBlock`s), same order as `labels`. */
  panels: readonly React.ReactNode[];
  /**
   * `localStorage` key shared by every tab set that should switch together
   * (e.g. all "curl / fetch" sample sets). Defaults to per-page, unsynced.
   */
  storageKey?: string;
  /** Accessible name for the tab list. */
  label?: string;
}

/**
 * Generic tabbed code panels, synced across the page and remembered when a
 * `storageKey` is given (the same mechanism as the package-manager tabs).
 * Inactive panels are `hidden` and `data-md-skip`, so the markdown export
 * carries only the first.
 */
export function CodeTabs({ labels, panels, storageKey, label = "Code sample" }: CodeTabsProps) {
  const [local, setLocal] = React.useState(labels[0]!);
  const subscribe = React.useCallback((onChange: () => void) => {
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const stored = React.useSyncExternalStore(
    subscribe,
    () => (storageKey ? read(storageKey, labels) : labels[0]!),
    () => labels[0]!
  );
  const active = storageKey ? stored : local;
  const baseId = React.useId();

  function select(next: string) {
    if (!storageKey) return setLocal(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Not persisted; the event below still switches this page.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div data-code-tabs className="not-prose my-4">
      <div role="tablist" aria-label={label} className="flex gap-1">
        {labels.map((id) => (
          <button
            key={id}
            id={`${baseId}-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={id === active}
            aria-controls={`${baseId}-panel-${id}`}
            tabIndex={id === active ? 0 : -1}
            onClick={() => select(id)}
            onKeyDown={(event) => {
              const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!delta) return;
              event.preventDefault();
              const next = labels[(labels.indexOf(active) + delta + labels.length) % labels.length]!;
              select(next);
              document.getElementById(`${baseId}-tab-${next}`)?.focus();
            }}
            className={cn(
              "rounded-md px-2.5 py-1 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              id === active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {id}
          </button>
        ))}
      </div>
      {labels.map((id, index) => (
        <div
          key={id}
          id={`${baseId}-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${id}`}
          hidden={id !== active}
          data-md-skip={index > 0 ? "" : undefined}
          className="[&>.code-editor]:mt-2"
        >
          {panels[index]}
        </div>
      ))}
    </div>
  );
}
