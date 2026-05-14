import { cn } from "../lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "ts", className }: CodeBlockProps) {
  return (
    <div className={cn("relative my-4 overflow-hidden rounded-lg border border-border bg-muted/40", className)}>
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{language}</span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="font-mono text-foreground whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}
