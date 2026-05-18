import { bundledLanguages, codeToHtml, type BundledLanguage } from "shiki/bundle/full";

import { cn } from "../lib/utils";
import { CodeCopyButton } from "./code-copy-button";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  showCopyButton?: boolean;
}

const LANGUAGE_ALIASES: Record<string, BundledLanguage | "text"> = {
  bash: "bash",
  dockerfile: "dockerfile",
  http: "http",
  ini: "ini",
  javascript: "js",
  json: "json",
  plain: "text",
  plaintext: "text",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "ts",
  txt: "text",
  typescript: "ts",
};

function resolveLanguage(language: string): BundledLanguage | "text" {
  const normalizedLanguage = language.trim().toLowerCase();

  if (normalizedLanguage in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[normalizedLanguage];
  }

  if (normalizedLanguage in bundledLanguages) {
    return normalizedLanguage as BundledLanguage;
  }

  return "text";
}

export async function CodeBlock({ code, language = "ts", className, showCopyButton = true }: CodeBlockProps) {
  const highlightedCode = await codeToHtml(code, {
    lang: resolveLanguage(language),
    themes: {
      light: "github-light-default",
      dark: "github-dark-default",
      dim: "github-dark-dimmed",
    },
    defaultColor: false,
  });

  return (
    <div className={cn("code-editor relative my-4 overflow-hidden rounded-xl border", className)} data-language={language}>
      <div className="code-editor__toolbar flex items-center justify-between gap-3 border-b px-3 py-2 text-[11px] sm:px-4 sm:text-xs">
        <span className="min-w-0 truncate font-mono">{language}</span>
        {showCopyButton ? <CodeCopyButton code={code} /> : null}
      </div>
      <div
        className="code-editor__content overflow-x-auto text-xs leading-relaxed sm:text-sm"
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    </div>
  );
}
