import { cn } from "../lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "ts", className }: CodeBlockProps) {
  return (
    <div className={cn("relative my-4 overflow-hidden rounded-lg border bg-zinc-950", className)}>
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-4 py-1.5 text-xs text-zinc-400">
        <span className="font-mono">{language}</span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="font-mono text-zinc-100 whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}
