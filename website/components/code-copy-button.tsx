"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

interface CodeCopyButtonProps {
  code: string;
}

async function writeToClipboard(code: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = code;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

export function CodeCopyButton({ code }: CodeCopyButtonProps) {
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
      await writeToClipboard(code);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
    }, 1800);
  }

  const label = status === "copied" ? "Copied" : status === "error" ? "Retry copy" : "Copy";
  const Icon = status === "copied" ? CheckIcon : CopyIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={handleCopy}
      aria-label={status === "copied" ? "Code copied to clipboard" : "Copy code to clipboard"}
      className="h-7 rounded-md border border-transparent px-2 font-sans text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:border-border hover:bg-background/80 hover:text-foreground focus-visible:border-ring"
    >
      <Icon className="size-3.5" weight="bold" />
      <span>{label}</span>
    </Button>
  );
}
