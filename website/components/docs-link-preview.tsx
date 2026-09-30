"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useDocsSearchIndex } from "@/lib/docs-search-client";

/** Hover delay before a preview opens, so skimming the mouse over prose is quiet. */
const OPEN_DELAY_MS = 350;
const CARD_WIDTH = 320;

type Preview = { href: string; top: number; left: number; above: boolean };

/**
 * Resolve an anchor to the docs route it points at, or `null` for anything
 * that should not get a preview (external links, same-page anchors, the page
 * being read, non-docs routes).
 *
 * @param anchor - The hovered link.
 * @param currentPath - The page being read.
 * @returns The target route without hash or query.
 */
export function previewTarget(anchor: HTMLAnchorElement, currentPath: string): string | null {
  const raw = anchor.getAttribute("href") ?? "";
  if (!raw.startsWith("/docs")) return null;
  const route = raw.split(/[?#]/, 1)[0]!.replace(/\/+$/, "") || "/docs";
  if (route === currentPath.replace(/\/+$/, "")) return null;
  return route;
}

/**
 * Hover cards for internal docs links: pointing at a `/docs/...` link inside
 * the article shows that page's title and description, like Fumadocs' link
 * previews. One delegated listener on the article, only on devices with a
 * fine pointer that can hover; the search index is fetched on first hover.
 * Purely supplementary: the link itself is untouched and keyboard/touch users
 * lose nothing.
 */
export function DocsLinkPreview() {
  const pathname = usePathname();
  const [enabled, setEnabled] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const { items } = useDocsSearchIndex(enabled);
  const byHref = React.useMemo(() => new Map(items.map((item) => [item.href as string, item])), [items]);

  React.useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const article = document.querySelector<HTMLElement>("[data-docs-content]");
    if (!article) return;

    let timer = 0;
    let current: HTMLAnchorElement | null = null;

    const close = () => {
      window.clearTimeout(timer);
      current = null;
      setPreview(null);
    };

    const onOver = (event: PointerEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement) || anchor === current) return;
      const target = previewTarget(anchor, window.location.pathname);
      if (!target) return;
      current = anchor;
      setEnabled(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        const above = rect.bottom + 140 > window.innerHeight;
        setPreview({
          href: target,
          top: above ? rect.top - 8 : rect.bottom + 8,
          left: Math.max(12, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 12)),
          above,
        });
      }, OPEN_DELAY_MS);
    };

    const onOut = (event: PointerEvent) => {
      if (!current) return;
      const next = event.relatedTarget as Node | null;
      if (next && current.contains(next)) return;
      close();
    };

    article.addEventListener("pointerover", onOver);
    article.addEventListener("pointerout", onOut);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      close();
      article.removeEventListener("pointerover", onOver);
      article.removeEventListener("pointerout", onOut);
      window.removeEventListener("scroll", close);
    };
  }, [pathname]);

  const item = preview ? byHref.get(preview.href) : undefined;
  if (!preview || !item) return null;

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{
        top: preview.top,
        left: preview.left,
        width: CARD_WIDTH,
        transform: preview.above ? "translateY(-100%)" : undefined,
      }}
    >
      {item.section ? (
        <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{item.section}</p>
      ) : null}
      <p className="mt-0.5 text-sm font-semibold text-foreground">{item.title}</p>
      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p>
    </div>
  );
}
