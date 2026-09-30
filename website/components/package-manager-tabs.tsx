"use client";

import * as React from "react";

import { PACKAGE_MANAGERS, type PackageManager } from "@/lib/package-managers";
import { cn } from "@/lib/utils";


const STORAGE_KEY = "daloy:package-manager";
const CHANGE_EVENT = "daloy:package-manager-change";
const DEFAULT_MANAGER: PackageManager = "pnpm";

function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === "string" && (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

function readStoredManager(): PackageManager {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isPackageManager(value) ? value : DEFAULT_MANAGER;
  } catch {
    // Storage can throw in private windows or with site data blocked.
    return DEFAULT_MANAGER;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The reader's preferred package manager, shared by every tab set on the page
 * and remembered across visits. The server snapshot is always `pnpm`, so the
 * first render matches the server HTML and the stored choice applies after
 * hydration.
 *
 * @returns The current manager and a setter that updates all tab sets.
 */
function usePackageManager(): [PackageManager, (next: PackageManager) => void] {
  const manager = React.useSyncExternalStore(subscribe, readStoredManager, () => DEFAULT_MANAGER);
  const setManager = React.useCallback((next: PackageManager) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; still switch this page's tab sets below.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [manager, setManager];
}

/** Props accepted by {@link PackageManagerTabs}. */
export interface PackageManagerTabsProps {
  /** Pre-rendered panel for each manager, usually a server-highlighted `CodeBlock`. */
  panels: Record<PackageManager, React.ReactNode>;
}

/**
 * Tab strip that switches install commands between pnpm, npm, yarn and bun.
 * The choice is synced across every tab set on the page and persisted in
 * `localStorage`, like Fumadocs' `groupId` + `persist` tabs.
 *
 * All panels are server-rendered; inactive ones are `hidden` and marked
 * `data-md-skip` so the markdown export only carries the default one.
 */
export function PackageManagerTabs({ panels }: PackageManagerTabsProps) {
  const [manager, setManager] = usePackageManager();
  const baseId = React.useId();

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = PACKAGE_MANAGERS.indexOf(manager);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = PACKAGE_MANAGERS[(index + delta + PACKAGE_MANAGERS.length) % PACKAGE_MANAGERS.length];
    setManager(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div data-package-manager-tabs className="not-prose my-4">
      <div role="tablist" aria-label="Package manager" className="flex gap-1">
        {PACKAGE_MANAGERS.map((id) => {
          const selected = id === manager;
          return (
            <button
              key={id}
              id={`${baseId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setManager(id)}
              onKeyDown={onKeyDown}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {id}
            </button>
          );
        })}
      </div>
      {PACKAGE_MANAGERS.map((id) => (
        <div
          key={id}
          id={`${baseId}-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${id}`}
          hidden={id !== manager}
          data-md-skip={id !== DEFAULT_MANAGER ? "" : undefined}
          className="[&>.code-editor]:mt-2"
        >
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
