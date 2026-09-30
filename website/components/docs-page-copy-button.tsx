"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  GithubLogoIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { writeTextToClipboard } from "@/lib/clipboard";
import { REPO_BRANCH, REPO_URL, type DocsPageMeta } from "@/lib/docs-page-meta-shared";
import { buildPageMarkdown } from "@/lib/page-markdown";
import { cn } from "@/lib/utils";

import { Button } from "./ui/button";

/**
 * Prompt used by the "Open in ChatGPT / Claude" actions. Points the assistant
 * at the page's markdown twin, which is cheaper to read than the HTML.
 */
function assistantPrompt(markdownUrl: string): string {
  return `Read ${markdownUrl}, I want to ask questions about it.`;
}

/**
 * Build the external "open in assistant" links for a page. Only the public
 * page URL goes into the query string, nothing about the reader.
 *
 * @param markdownUrl - Absolute URL of the page's `.md` representation.
 * @returns ChatGPT and Claude deep links with the prompt prefilled.
 */
export function assistantLinks(markdownUrl: string): { chatgpt: string; claude: string } {
  const q = encodeURIComponent(assistantPrompt(markdownUrl));
  return {
    chatgpt: `https://chatgpt.com/?hints=search&q=${q}`,
    claude: `https://claude.ai/new?q=${q}`,
  };
}

const TRIGGER_CLASS =
  "h-11 shrink-0 border border-taupe-200/80 bg-taupe-50/75 text-[11px] tracking-[0.22em] text-taupe-950 shadow-sm hover:bg-taupe-100/70 dark:border-taupe-900/70 dark:bg-taupe-950/20 dark:text-taupe-100 dark:hover:bg-taupe-950/35 dim:border-taupe-900/60 dim:bg-taupe-950/18 dim:text-taupe-100 sm:text-xs";

const ITEM_CLASS =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground outline-none select-none data-[highlighted]:bg-muted";

/**
 * Docs page actions: "Copy page" (the rendered article as markdown, for
 * pasting into an LLM) plus a menu with View as Markdown, Open in ChatGPT,
 * Open in Claude, and View source on GitHub.
 *
 * @param props.meta - Route → source map from `getDocsPageMeta()`, used for the GitHub link.
 */
export function DocsPageCopyButton({ meta = {} }: { meta?: Record<string, DocsPageMeta> }) {
  const pathname = usePathname();
  const [status, setStatus] = React.useState<"idle" | "copied" | "error">("idle");
  const resetTimeoutRef = React.useRef<number | null>(null);
  const route = pathname.replace(/\/+$/, "") || "/docs";
  const source = meta[route]?.source;

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

  function openAssistant(target: "chatgpt" | "claude") {
    const links = assistantLinks(`${window.location.origin}${route}.md`);
    window.open(links[target], "_blank", "noopener,noreferrer");
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
    <div className="relative flex shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        aria-label={status === "copied" ? "Page markdown copied to clipboard" : "Copy page as markdown"}
        aria-describedby={message ? "docs-copy-page-message" : undefined}
        className={cn(TRIGGER_CLASS, "rounded-s-xl rounded-e-none border-e-0 px-4")}
      >
        <Icon className="size-3.5" weight="bold" />
        <span className="hidden sm:inline">{label}</span>
      </Button>

      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="More page actions"
              className={cn(TRIGGER_CLASS, "rounded-s-none rounded-e-xl px-2.5")}
            />
          }
        >
          <CaretDownIcon className="size-3.5" weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className="w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none">
              <Menu.LinkItem href={`${route}.md`} className={ITEM_CLASS} closeOnClick>
                <FileTextIcon aria-hidden className="size-4 text-muted-foreground" />
                View as Markdown
              </Menu.LinkItem>
              <Menu.Item className={ITEM_CLASS} onClick={() => openAssistant("chatgpt")}>
                <ArrowSquareOutIcon aria-hidden className="size-4 text-muted-foreground" />
                Open in ChatGPT
              </Menu.Item>
              <Menu.Item className={ITEM_CLASS} onClick={() => openAssistant("claude")}>
                <ArrowSquareOutIcon aria-hidden className="size-4 text-muted-foreground" />
                Open in Claude
              </Menu.Item>
              {source ? (
                <Menu.LinkItem
                  href={`${REPO_URL}/blob/${REPO_BRANCH}/${source}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ITEM_CLASS}
                  closeOnClick
                >
                  <GithubLogoIcon aria-hidden className="size-4 text-muted-foreground" />
                  View source on GitHub
                </Menu.LinkItem>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

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
