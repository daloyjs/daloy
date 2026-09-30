"use client";

import * as React from "react";

import type { DocsSearchItem, DocsSearchSection } from "./docs-search";

let indexPromise: Promise<DocsSearchSection[]> | null = null;

/**
 * Fetch the docs search index once per page load and share it between the
 * search dialog, the 404 suggestions and the link previews. A failed fetch is
 * not cached, so the next caller retries.
 *
 * @returns The grouped search index.
 */
export function loadDocsSearchIndex(): Promise<DocsSearchSection[]> {
  indexPromise ??= fetch("/docs/search-index.json", { headers: { accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`search index: HTTP ${response.status}`);
      return response.json() as Promise<DocsSearchSection[]>;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

/**
 * React hook around {@link loadDocsSearchIndex}. Starts loading when
 * `enabled` first becomes true and keeps the result afterwards.
 *
 * @param enabled - Whether the index is needed yet (e.g. the dialog opened).
 * @returns The sections (empty until loaded), a flat item list, and status.
 */
export function useDocsSearchIndex(enabled: boolean): {
  sections: DocsSearchSection[];
  items: DocsSearchItem[];
  status: "idle" | "loading" | "ready" | "error";
} {
  const [state, setState] = React.useState<{ sections: DocsSearchSection[]; status: "idle" | "loading" | "ready" | "error" }>({
    sections: [],
    status: "idle",
  });

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState((current) => (current.status === "ready" ? current : { ...current, status: "loading" }));
    });
    loadDocsSearchIndex().then(
      (sections) => {
        if (!cancelled) setState({ sections, status: "ready" });
      },
      () => {
        if (!cancelled) setState((current) => ({ ...current, status: "error" }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const items = React.useMemo(() => state.sections.flatMap((section) => section.items), [state.sections]);
  return { sections: state.sections, items, status: state.status };
}
