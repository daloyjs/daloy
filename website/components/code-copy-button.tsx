"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useUiStrings } from "@/components/site-locale";
import { writeTextToClipboard } from "@/lib/clipboard";

interface CodeCopyButtonProps {
  code: string;
}

/**
 * Copy-to-clipboard button for code samples, labelled in the document's
 * language.
 *
 * @param props.code - Text to copy.
 */
export function CodeCopyButton({ code }: CodeCopyButtonProps) {
  const strings = useUiStrings();
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
      await writeTextToClipboard(code);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
    }, 1800);
  }

  const label = status === "copied" ? strings.copied : status === "error" ? strings.retryCopy : strings.copy;
  const Icon = status === "copied" ? CheckIcon : CopyIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={handleCopy}
      aria-label={status === "copied" ? strings.copiedAria : strings.copyAria}
      className="h-7 rounded-md border border-transparent px-2 font-sans text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:border-border hover:bg-background/80 hover:text-foreground focus-visible:border-ring"
    >
      <Icon className="size-3.5" weight="bold" />
      <span>{label}</span>
    </Button>
  );
}
