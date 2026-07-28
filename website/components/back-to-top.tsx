"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BlogPos = { top: number; right: number };

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Shared pill ────────────────────────────────────────────────────────────────
// The smooth-scroll button itself, sized for either the anchored or floating
// layout. Kept in one place so both blog modes stay visually identical.
function Pill({ size }: { size: "xs" | "sm" }) {
  return (
    <Button
      onClick={scrollToTop}
      variant="outline"
      size={size}
      className="flex items-center gap-1 rounded-full border-border/50 bg-background/95 shadow-sm backdrop-blur-sm hover:bg-background"
      aria-label="Back to top"
    >
      <ArrowUpIcon
        className={size === "xs" ? "size-3" : "size-3.5"}
        weight="bold"
      />
      Back to Top
    </Button>
  );
}

// Locate the author-bio card to anchor against. Only matches the semantic
// `<footer>` author card; posts that end with any other markup fall back to the
// scroll-triggered floating button so the control can never silently disappear.
function findBioCard(): Element | null {
  return document.querySelector(
    "article footer.not-prose .rounded-xl, article footer.not-prose .rounded-2xl",
  );
}

// ── Blog variant ──────────────────────────────────────────────────────────────
// Prefers anchoring the pill to the author-bio card's top-right corner (the
// original design). When no such card is found, it degrades to a scroll-based
// floating button so every post shows a working control regardless of markup.
function BlogBackToTop() {
  const [pos, setPos] = useState<BlogPos | null>(null);
  const [floating, setFloating] = useState(false);
  // null = detection not finished yet; true = anchored mode; false = fallback.
  const [anchored, setAnchored] = useState<boolean | null>(null);
  const cardRef = useRef<Element | null>(null);

  useEffect(() => {
    const update = () => {
      const card = cardRef.current;
      if (card) {
        const rect = card.getBoundingClientRect();
        const inView = rect.top < window.innerHeight - 40 && rect.bottom > 0;
        setPos(
          inView
            ? { top: rect.top + 14, right: window.innerWidth - rect.right + 14 }
            : null,
        );
      } else {
        setFloating(window.scrollY > 600);
      }
    };

    const init = () => {
      cardRef.current = findBioCard();
      setAnchored(cardRef.current != null);
      update();
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update, { passive: true });
    };

    // Give React a tick to finish rendering the article
    const t = setTimeout(init, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Detection hasn't run yet; render nothing to avoid a flash.
  if (anchored === null) return null;

  // Fallback: floating button for posts without a footer author card.
  if (!anchored) {
    return (
      <div
        className={cn(
          "fixed bottom-8 right-4 z-50 transition-[opacity,transform] duration-300 ease-out sm:right-6",
          floating
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-4 scale-95 opacity-0",
        )}
      >
        <Pill size="sm" />
      </div>
    );
  }

  // Anchored: pill tracks the author-bio card's top-right corner.
  return (
    <div
      style={
        pos
          ? { position: "fixed", top: pos.top, right: pos.right, zIndex: 50 }
          : { position: "fixed", top: -200, right: -200, zIndex: 50 }
      }
      className={cn(
        "transition-[opacity,transform] duration-300 ease-out",
        pos
          ? "pointer-events-auto scale-100 opacity-100"
          : "pointer-events-none scale-95 opacity-0",
      )}
    >
      <Pill size="xs" />
    </div>
  );
}

// ── Docs variant ──────────────────────────────────────────────────────────────
// Simple scroll-based trigger; floats at the bottom-right away from content.
function DocsBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const remaining =
        document.documentElement.scrollHeight - window.innerHeight - scrolled;
      setVisible(scrolled > 200 && remaining < 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={cn(
        "fixed bottom-8 right-4 z-50 transition-[opacity,transform] duration-300 ease-out lg:right-1/4",
        visible
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-4 scale-95 opacity-0",
      )}
    >
      <Button
        onClick={scrollToTop}
        variant="outline"
        size="sm"
        className="flex items-center gap-1.5 rounded-full border-border/60 bg-background/90 shadow-lg backdrop-blur-sm hover:bg-background"
        aria-label="Back to top"
      >
        <ArrowUpIcon className="size-3.5" weight="bold" />
        Back to Top
      </Button>
    </div>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
/**
 * Renders a context-appropriate "Back to top" control based on the current
 * route. Blog posts get a button anchored to their author-bio card (with a
 * scroll-triggered floating fallback when no such card exists); docs pages get a
 * floating button near the bottom of the page. All other routes render nothing.
 *
 * @returns The route-specific back-to-top button, or `null` outside blog/docs.
 */
export function BackToTop() {
  const pathname = usePathname();
  if (pathname?.startsWith("/blog/") && pathname !== "/blog")
    return <BlogBackToTop />;
  if (pathname?.startsWith("/docs/") && pathname !== "/docs")
    return <DocsBackToTop />;
  return null;
}
