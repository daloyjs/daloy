"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { writeTextToClipboard } from "@/lib/clipboard";

import { Button } from "./ui/button";

function escapeInlineMarkdown(text: string) {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function escapeTableCell(text: string) {
  return text.replace(/\|/g, "\\|");
}

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ");
}

function trimBlankLines(text: string) {
  return text.replace(/^\n+|\n+$/g, "");
}

function inlineNodesToMarkdown(nodes: Node[]) {
  return normalizeInlineMarkdown(nodes.map((node) => inlineNodeToMarkdown(node)).join(""));
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return collapseWhitespace(node.textContent ?? "");
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  if (node.classList.contains("code-editor")) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === "br") {
    return "  \n";
  }

  if (tagName === "code" && !node.closest("pre")) {
    return `\`${trimBlankLines(node.textContent ?? "")}\``;
  }

  if (tagName === "a") {
    const text = inlineNodesToMarkdown(Array.from(node.childNodes)).trim() || (node.textContent ?? "").trim();
    const href = node.getAttribute("href") ?? "";

    return href ? `[${text}](${href})` : text;
  }

  if (tagName === "strong" || tagName === "b") {
    return `**${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}**`;
  }

  if (tagName === "em" || tagName === "i") {
    return `*${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}*`;
  }

  return Array.from(node.childNodes)
    .map((child) => inlineNodeToMarkdown(child))
    .join("");
}

function normalizeInlineMarkdown(text: string) {
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

function codeBlockToMarkdown(element: HTMLElement) {
  const language = element.dataset.language ?? "text";
  const pre = element.querySelector("pre");
  const code = trimBlankLines(pre?.textContent ?? "");
  const fence = language === "text" ? "```" : `\`\`\`${language}`;

  return code ? `${fence}\n${code}\n\`\`\`` : "";
}

function tableToMarkdown(table: HTMLTableElement) {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td")).map((cell) =>
        escapeTableCell(inlineNodesToMarkdown(Array.from(cell.childNodes)).trim())
      )
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const cells = [...row];

    while (cells.length < columnCount) {
      cells.push("");
    }

    return `| ${cells.join(" | ")} |`;
  });

  const separator = `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;

  return [normalizedRows[0], separator, ...normalizedRows.slice(1)].join("\n");
}

function listToMarkdown(list: HTMLUListElement | HTMLOListElement, depth = 0) {
  const ordered = list.tagName.toLowerCase() === "ol";

  return Array.from(list.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    .map((item, index) => listItemToMarkdown(item, ordered ? `${index + 1}.` : "-", depth))
    .join("\n");
}

function listItemToMarkdown(item: HTMLLIElement, marker: string, depth: number) {
  const nestedBlocks: string[] = [];
  const contentParts: Node[] = [];

  Array.from(item.childNodes).forEach((child) => {
    if (
      child instanceof HTMLElement &&
      (child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol")
    ) {
      nestedBlocks.push(listToMarkdown(child as HTMLUListElement | HTMLOListElement, depth + 1));
      return;
    }

    contentParts.push(child);
  });

  const indent = "  ".repeat(depth);
  const content = inlineNodesToMarkdown(contentParts).trim();
  const lines = [`${indent}${marker} ${content}`.trimEnd()];

  nestedBlocks.filter(Boolean).forEach((block) => {
    lines.push(block);
  });

  return lines.join("\n");
}

function blockNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = collapseWhitespace(node.textContent ?? "").trim();
    return text ? escapeInlineMarkdown(text) : "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  if (node.classList.contains("code-editor")) {
    return codeBlockToMarkdown(node);
  }

  const tagName = node.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName[1]);
    return `${"#".repeat(level)} ${inlineNodesToMarkdown(Array.from(node.childNodes))}`;
  }

  if (tagName === "p") {
    return inlineNodesToMarkdown(Array.from(node.childNodes));
  }

  if (tagName === "ul" || tagName === "ol") {
    return listToMarkdown(node as HTMLUListElement | HTMLOListElement);
  }

  if (tagName === "pre") {
    const code = trimBlankLines(node.textContent ?? "");
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }

  if (tagName === "blockquote") {
    const content = childrenToMarkdown(node)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");

    return content;
  }

  if (tagName === "table") {
    return tableToMarkdown(node as HTMLTableElement);
  }

  if (tagName === "hr") {
    return "---";
  }

  return childrenToMarkdown(node) || inlineNodesToMarkdown(Array.from(node.childNodes));
}

function childrenToMarkdown(element: HTMLElement) {
  return trimBlankLines(
    Array.from(element.childNodes)
      .map((child) => blockNodeToMarkdown(child))
      .filter(Boolean)
      .join("\n\n")
  );
}

function buildPageMarkdown(article: HTMLElement, pathname: string) {
  const body = childrenToMarkdown(article);

  if (!body) {
    return "";
  }

  const sourceUrl = typeof window !== "undefined" ? `${window.location.origin}${pathname}` : pathname;

  return `${body}\n\n---\n\nSource: ${sourceUrl}`;
}

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

      const markdown = buildPageMarkdown(article, pathname);

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
        <span>{label}</span>
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