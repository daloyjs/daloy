"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { writeTextToClipboard } from "@/lib/clipboard";
import { buildPageMarkdown } from "@/lib/page-markdown";

import { Button } from "./ui/button";

export function DocsPageCopyButton() {
  const pathname = usePathname();
  const [status, setStatus] = React.useState<"idle" | "copied" | "error">("idle");
  const resetTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }

    try {
      const article = document.querySelector<HTMLElement>("[data-docs-content]");

      if (!article) {
        throw new Error("Docs content not found");
      }

      const markdown = buildPageMarkdown(article, `${window.location.origin}${pathname}`);

      if (!markdown) {
        throw new Error("Docs content is empty");
      }

      await writeTextToClipboard(markdown);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
    }, 1800);
  }

  const Icon = status === "copied" ? CheckIcon : CopyIcon;
  const label = status === "copied" ? "Copied" : status === "error" ? "Retry copy" : "Copy page";
  const message =
    status === "copied"
      ? "Markdown copied. Paste it into Copilot Chat or any LLM for page context."
      : status === "error"
        ? "Copy failed. Try again."
        : null;

  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        aria-label={status === "copied" ? "Page markdown copied to clipboard" : "Copy page as markdown"}
        aria-describedby={message ? "docs-copy-page-message" : undefined}
        className="h-11 shrink-0 rounded-xl border border-taupe-200/80 bg-taupe-50/75 px-4 text-[11px] tracking-[0.22em] text-taupe-950 shadow-sm hover:bg-taupe-100/70 dark:border-taupe-900/70 dark:bg-taupe-950/20 dark:text-taupe-100 dark:hover:bg-taupe-950/35 dim:border-taupe-900/60 dim:bg-taupe-950/18 dim:text-taupe-100 sm:text-xs"
      >
        <Icon className="size-3.5" weight="bold" />
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {message ? (
        <div
          id="docs-copy-page-message"
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-taupe-200/80 bg-background/95 px-3 py-2 text-[11px] font-medium normal-case tracking-normal text-foreground shadow-lg backdrop-blur dark:border-taupe-900/70 dim:border-taupe-900/60 sm:w-80"
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}