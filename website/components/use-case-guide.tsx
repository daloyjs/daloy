import { cn } from "../lib/utils";

interface UseCaseGuideProps {
  featureName: string;
  recommendation: string;
  whenToUse: string[];
  whenNotToUse: string[];
  className?: string;
}

export function UseCaseGuide({
  featureName,
  recommendation,
  whenToUse,
  whenNotToUse,
  className,
}: UseCaseGuideProps) {
  return (
    <div className={cn("not-prose my-8 space-y-6", className)}>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Key Recommendation for {featureName}
        </h4>
        <p className="text-sm font-medium text-foreground">{recommendation}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* When & Where to Use */}
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.04] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-0 mb-4 border-b border-emerald-500/10 pb-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            When & Where to Use
          </h3>
          <ul className="space-y-3 pl-0 list-none text-xs leading-relaxed text-muted-foreground">
            {whenToUse.map((item, idx) => (
              <li key={idx} className="flex gap-2.5 items-start text-left">
                <span className="mt-0.5 text-emerald-500 font-bold shrink-0">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* When & Where NOT to Use */}
        <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.02] dark:bg-rose-500/[0.04] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400 mt-0 mb-4 border-b border-rose-500/10 pb-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            When & Where NOT to Use
          </h3>
          <ul className="space-y-3 pl-0 list-none text-xs leading-relaxed text-muted-foreground">
            {whenNotToUse.map((item, idx) => (
              <li key={idx} className="flex gap-2.5 items-start text-left">
                <span className="mt-0.5 text-rose-500 font-bold shrink-0">✗</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
