import {
  ArrowRightIcon,
  BookOpenTextIcon,
  BroadcastIcon,
  CubeIcon,
  FileCodeIcon,
  GlobeIcon,
  LockIcon,
  PackageIcon,
  PlugsConnectedIcon,
  SparkleIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  TranslateIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BenchmarkCharts } from "@/components/benchmark-charts";
import { CodeBlock } from "@/components/code-block";
import { CodeCopyButton } from "@/components/code-copy-button";
import { ContractFlowVisual } from "@/components/contract-flow-visual";
import { FlowHeroScene } from "@/components/flow-hero-scene";
import { LocaleLink } from "@/components/locale-link";
import { ScalarPreview } from "@/components/scalar-preview";
import { serializeJsonLd } from "@/lib/seo";
import {
  FEATURE_KEYS,
  type FeatureKey,
  type HomeCopy,
  type McpToolName,
} from "./home-copy";

const CREATE_COMMAND = "pnpm create daloy@latest my-api";

const MCP_ENDPOINT_URL = "https://daloyjs.dev/mcp";

const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "daloyjs-docs": {
      "url": "https://daloyjs.dev/mcp"
    }
  }
}`;

const MCP_TOOL_NAMES: readonly McpToolName[] = [
  "search_docs",
  "get_doc",
  "list_docs",
];

/** Locale-independent layout of each bento card. */
const FEATURE_LAYOUT: Record<
  FeatureKey,
  { icon: typeof ShieldCheckIcon; span: string }
> = {
  secureDefaults: { icon: ShieldCheckIcon, span: "md:col-span-2 lg:col-span-2" },
  zeroDeps: { icon: PackageIcon, span: "lg:col-span-1" },
  supplyChain: { icon: LockIcon, span: "lg:col-span-2" },
  aiNative: { icon: SparkleIcon, span: "lg:col-span-1" },
  streaming: { icon: BroadcastIcon, span: "lg:col-span-1" },
  portable: { icon: GlobeIcon, span: "lg:col-span-1" },
  contractFirst: { icon: FileCodeIcon, span: "lg:col-span-1" },
  typedClients: { icon: RocketLaunchIcon, span: "lg:col-span-1" },
  batteries: { icon: CubeIcon, span: "lg:col-span-2" },
};

const FEATURE_ACCENTS = [
  {
    card: "border border-mauve-200/70 bg-mauve-50/60 dark:border-mauve-900/70 dark:bg-mauve-950/18 dim:border-mauve-900/60 dim:bg-mauve-950/15",
    icon: "bg-mauve-100 text-mauve-700 ring-1 ring-mauve-200/80 dark:bg-mauve-950/40 dark:text-mauve-200 dark:ring-mauve-800/70 dim:bg-mauve-950/35 dim:text-mauve-100",
  },
  {
    card: "border border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15",
    icon: "bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100",
  },
  {
    card: "border border-mist-200/75 bg-mist-50/65 dark:border-mist-900/70 dark:bg-mist-950/18 dim:border-mist-900/60 dim:bg-mist-950/15",
    icon: "bg-mist-100 text-mist-700 ring-1 ring-mist-200/80 dark:bg-mist-950/40 dark:text-mist-200 dark:ring-mist-800/70 dim:bg-mist-950/35 dim:text-mist-100",
  },
  {
    card: "border border-taupe-200/70 bg-taupe-50/60 dark:border-taupe-900/70 dark:bg-taupe-950/18 dim:border-taupe-900/60 dim:bg-taupe-950/15",
    icon: "bg-taupe-100 text-taupe-700 ring-1 ring-taupe-200/80 dark:bg-taupe-950/40 dark:text-taupe-200 dark:ring-taupe-800/70 dim:bg-taupe-950/35 dim:text-taupe-100",
  },
] as const;

/**
 * The landing page, shared by every locale. `app/page.tsx` (English) and
 * `app/es/page.tsx` (Castilian Spanish) only supply metadata, JSON-LD and a
 * {@link HomeCopy}; the markup lives here so the two cannot drift apart.
 *
 * @param props.copy - All locale-specific strings and snippets.
 * @param props.jsonLd - Structured data nodes for this locale's page.
 */
export function HomePage({
  copy,
  jsonLd,
}: {
  copy: HomeCopy;
  jsonLd: readonly Record<string, unknown>[];
}) {
  const { locale } = copy;

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      {/* Hero */}
      <section className="relative isolate overflow-hidden border-b bg-background">
        <FlowHeroScene />
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-12 lg:py-16">
          <div className="flex flex-col items-center gap-5 text-center">
            {/* Language notice: a plain <a> because it crosses locales. */}
            <a
              href={copy.languageNotice.href}
              hrefLang={copy.languageNotice.lang}
              lang={copy.languageNotice.lang}
              className="float-up group inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-mist-200/80 bg-mist-50/85 px-3 py-1.5 text-sm text-mist-950 shadow-sm transition-colors hover:border-mist-300 hover:bg-mist-100/90 dark:border-mist-900/70 dark:bg-mist-950/30 dark:text-mist-100 dark:hover:bg-mist-950/50 dim:border-mist-900/60 dim:bg-mist-950/25 dim:text-mist-100"
              style={{ animationDelay: "40ms" }}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-200/70 px-2 py-0.5 text-xs font-semibold dark:bg-mist-800/60 dim:bg-mist-800/50">
                <TranslateIcon aria-hidden className="size-3.5" />
                {copy.languageNotice.badge}
              </span>
              <span>{copy.languageNotice.text}</span>
              <span className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
                {copy.languageNotice.cta}
                <ArrowRightIcon
                  aria-hidden
                  className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </span>
            </a>
            <h1
              className="float-up max-w-4xl text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              {copy.hero.title}
            </h1>
            <h2
              className="float-up max-w-3xl text-base font-medium text-foreground/80 text-pretty sm:text-lg"
              style={{ animationDelay: "120ms" }}
            >
              {copy.hero.subtitle}
            </h2>
            <div
              className="float-up mt-2 flex flex-col gap-3 sm:flex-row"
              style={{ animationDelay: "160ms" }}
            >
              <LocaleLink
                locale={locale}
                href={copy.links.gettingStarted}
                className={buttonVariants({ size: "lg" }) + " group"}
              >
                {copy.hero.primaryCta}
                <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </LocaleLink>
              <LocaleLink
                locale={locale}
                href={copy.links.docs}
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                {copy.hero.secondaryCta}
              </LocaleLink>
            </div>
            {copy.hero.contentLanguageNote ? (
              <p
                className="float-up -mt-2 text-xs text-muted-foreground"
                style={{ animationDelay: "180ms" }}
              >
                {copy.hero.contentLanguageNote}
              </p>
            ) : null}
            <div
              className="float-up flex max-w-full items-center gap-2 rounded-md border border-taupe-200/80 bg-taupe-50/85 px-3 py-2 text-taupe-950 shadow-sm dark:border-taupe-900/70 dark:bg-taupe-950/25 dark:text-taupe-100 dim:border-mist-900/60 dim:bg-mist-950/20 dim:text-mist-100"
              style={{ animationDelay: "200ms" }}
            >
              <code className="overflow-x-auto text-sm whitespace-nowrap">
                $ {CREATE_COMMAND}
              </code>
              <CodeCopyButton code={CREATE_COMMAND} />
            </div>
            <ul
              aria-label={copy.hero.factsLabel}
              className='float-up flex flex-wrap justify-center gap-2 font-features-["tnum"] text-xs text-muted-foreground'
              style={{ animationDelay: "240ms" }}
            >
              {copy.hero.facts.map((fact) => (
                <li
                  key={fact}
                  className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-1"
                >
                  {fact}
                </li>
              ))}
            </ul>
            <div
              className="float-up mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground"
              style={{ animationDelay: "280ms" }}
            >
              <span>{copy.hero.nameNote}</span>
              <span aria-hidden className="text-border">•</span>
              <LocaleLink
                locale={locale}
                href={copy.hero.aboutHref}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {copy.hero.aboutLabel}
              </LocaleLink>
              <span aria-hidden className="text-border">•</span>
              <LocaleLink
                locale={locale}
                href={copy.hero.nameHref}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {copy.hero.nameLabel}
              </LocaleLink>
              <span aria-hidden className="text-border">•</span>
              <LocaleLink
                locale={locale}
                href={copy.links.tutorial}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {copy.hero.tutorialLabel}
              </LocaleLink>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Architecture - Bento Grid */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.security.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.security.title}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              {copy.security.body}
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURE_KEYS.map((key, i) => {
              const f = copy.features[key];
              const layout = FEATURE_LAYOUT[key];
              const accent = FEATURE_ACCENTS[i % FEATURE_ACCENTS.length];

              return (
                <Card
                  key={key}
                  className={`${accent.card} ${layout.span} group float-up transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <CardHeader>
                    <span
                      className={`${accent.icon} mb-2 inline-flex size-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110`}
                    >
                      <layout.icon className="size-6" />
                    </span>
                    <CardTitle>{f.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <CardDescription className="text-sm leading-relaxed">
                      {f.body}
                    </CardDescription>
                  </CardContent>
                  {f.badges && f.badges.length > 0 && (
                    <CardFooter className="flex-wrap gap-1.5">
                      {f.badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-md border border-border/70 bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground/80 dark:bg-background/50"
                        >
                          {badge}
                        </span>
                      ))}
                    </CardFooter>
                  )}
                  {f.stat && (
                    <CardFooter>
                      <div className="flex w-full items-baseline gap-2.5 rounded-lg border border-border/60 bg-background/60 px-3 py-2 dark:bg-background/40">
                        <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground">
                          {f.stat.value}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {f.stat.label}
                        </span>
                      </div>
                    </CardFooter>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benchmarks & Performance */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.benchmarks.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.benchmarks.title}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              {copy.benchmarks.body}
            </p>
          </div>
          <BenchmarkCharts copy={copy.benchmarks.charts} />
        </div>
      </section>

      {/* MCP - AI Agent Integration */}
      <section id="mcp" className="border-b scroll-mt-20">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.mcp.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.mcp.title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-muted-foreground">
              {copy.mcp.intro}
            </p>
          </div>

          <Card className="mb-10 border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15">
            <CardContent className="grid gap-8 pt-2 lg:grid-cols-2 lg:items-center">
              <div className="flex flex-col gap-4">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100">
                  <PlugsConnectedIcon className="size-6" />
                </span>
                <h3 className="text-xl font-bold tracking-tight">
                  {copy.mcp.serverTitle}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {copy.mcp.serverBody}
                </p>
                <LocaleLink
                  locale={locale}
                  href={copy.links.mcp}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  {copy.mcp.serverCta}
                </LocaleLink>
              </div>
              <CodeBlock
                code={copy.mcp.serverSnippet}
                language="ts"
                showCopyButton={false}
              />
            </CardContent>
          </Card>

          <div className="mb-6 text-center">
            <h3 className="text-xl font-bold tracking-tight">
              {copy.mcp.docsTitle}
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {copy.mcp.docsBody}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
            <Card className="flex flex-col border-olive-200/70 bg-olive-50/55 dark:border-olive-900/70 dark:bg-olive-950/18 dim:border-olive-900/60 dim:bg-olive-950/15">
              <CardHeader>
                <span className="mb-2 inline-flex size-11 items-center justify-center rounded-xl bg-olive-100 text-olive-700 ring-1 ring-olive-200/80 dark:bg-olive-950/40 dark:text-olive-200 dark:ring-olive-800/70 dim:bg-olive-950/35 dim:text-olive-100">
                  <SparkleIcon className="size-6" />
                </span>
                <CardTitle>{copy.mcp.endpointTitle}</CardTitle>
                <CardDescription>{copy.mcp.endpointBody}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="flex items-center justify-between gap-2 rounded-md border border-taupe-200/80 bg-taupe-50/85 px-3 py-2 text-taupe-950 shadow-sm dark:border-taupe-900/70 dark:bg-taupe-950/25 dark:text-taupe-100 dim:border-mist-900/60 dim:bg-mist-950/20 dim:text-mist-100">
                  <code className="text-sm break-all">{MCP_ENDPOINT_URL}</code>
                  <CodeCopyButton code={MCP_ENDPOINT_URL} />
                </div>
                <ul className="flex flex-col gap-3 text-sm">
                  {MCP_TOOL_NAMES.map((name) => (
                    <li key={name} className="flex flex-col gap-0.5">
                      <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {name}
                      </code>
                      <span className="text-muted-foreground">
                        {copy.mcp.tools[name]}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-foreground">
                {copy.mcp.configLabel}
              </p>
              <CodeBlock code={MCP_CLIENT_CONFIG} language="json" />
              <p className="text-sm leading-6 text-muted-foreground">
                {copy.mcp.stdioNote}{" "}
                <code>npx -y mcp-remote {MCP_ENDPOINT_URL}</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contracts as Blast-Radius Safety Boundaries */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div
            className="float-up mb-8 text-center"
            style={{ animationDelay: "80ms" }}
          >
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.contracts.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.contracts.title}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              {copy.contracts.body}
            </p>
          </div>
          <div className="mb-8">
            <ContractFlowVisual copy={copy.contracts.flow} />
          </div>
          <div className="float-up" style={{ animationDelay: "120ms" }}>
            <CodeBlock
              code={copy.contracts.helloWorld}
              language="ts"
              showCopyButton={false}
            />
          </div>
        </div>
      </section>

      {/* Scalar docs */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-10 flex flex-col items-center gap-3 text-center">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-mist-100 text-mist-700 ring-1 ring-mist-200/80 dark:bg-mist-950/40 dark:text-mist-200 dark:ring-mist-800/70 dim:bg-mist-950/35 dim:text-mist-100">
              <BookOpenTextIcon className="size-6" />
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-balance">
              {copy.scalar.title}
            </h2>
            <p className="max-w-3xl leading-8 text-muted-foreground">
              {copy.scalar.body}
            </p>
          </div>
          <ScalarPreview />
          <p className="mt-4 text-center text-sm leading-6 text-muted-foreground">
            {copy.scalar.footer}{" "}
            <LocaleLink
              locale={locale}
              href={copy.links.openapi}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {copy.scalar.guideCta}
            </LocaleLink>
          </p>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.comparison.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.comparison.title}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-8 text-muted-foreground">
              {copy.comparison.body}
            </p>
          </div>

          {/* Mobile view: Stacked card format */}
          <div className="space-y-4 md:hidden">
            {copy.comparison.rows.map((row) => (
              <div
                key={row.want}
                className="rounded-xl border border-border/80 bg-card p-4 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {copy.comparison.youWant}
                  </span>
                  <span className="rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {copy.comparison.todayPrefix} {row.best}
                  </span>
                </div>
                <p className="mt-1.5 font-semibold text-foreground">
                  {row.want}
                </p>
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <span className="mb-1 block text-[11px] font-semibold tracking-wider text-foreground/70 uppercase">
                    {copy.comparison.daloyGives}
                  </span>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {row.give}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop view: Structured table */}
          <div className="hidden scrollbar-thin scrollbar-thumb-mist-300 scrollbar-track-transparent overflow-x-auto rounded-lg border md:block dark:scrollbar-thumb-mist-700 dim:scrollbar-thumb-mist-800">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">{copy.comparison.youWant}</th>
                  <th className="p-3 text-left">{copy.comparison.todaysBest}</th>
                  <th className="p-3 text-left">{copy.comparison.daloyGives}</th>
                </tr>
              </thead>
              <tbody>
                {copy.comparison.rows.map((row) => (
                  <tr key={row.want} className="border-t">
                    <td className="p-3 font-medium">{row.want}</td>
                    <td className="p-3 text-muted-foreground">{row.best}</td>
                    <td className="p-3">{row.give}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-balance">
            {copy.cta.title}
          </h2>
          <p className="mb-8 leading-8 text-muted-foreground">{copy.cta.body}</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <LocaleLink
              locale={locale}
              href={copy.links.installation}
              className={buttonVariants({ size: "lg" })}
            >
              {copy.cta.install}
            </LocaleLink>
            <LocaleLink
              locale={locale}
              href={copy.links.tutorial}
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              {copy.cta.tutorial}
            </LocaleLink>
            <a
              href="https://github.com/daloyjs/daloy"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              {copy.cta.source}
            </a>
          </div>
        </div>
      </section>

      {/* Support */}
      <section className="border-b bg-mauve-50/35 dark:bg-mauve-950/10 dim:bg-mauve-950/10">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <div className="rounded-3xl border border-mauve-200/70 bg-background/90 p-8 text-center shadow-sm dark:border-mauve-900/70 dark:bg-background/80">
            <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              {copy.support.eyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">
              {copy.support.title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-muted-foreground">
              {copy.support.body}
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="https://buymeacoffee.com/daloyjs"
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ size: "lg" })}
              >
                {copy.support.coffee}
              </a>
              <LocaleLink
                locale={locale}
                href={copy.links.blog}
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                {copy.support.blog}
              </LocaleLink>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
