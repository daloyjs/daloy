"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BENCH_META,
  BENCH_NOTES,
  BUNDLE_GZIP_BYTES,
  DEPENDENCY_COUNT,
  type FootprintRow,
  INSTALL_FOOTPRINT_BYTES,
  MIDDLEWARE_THROUGHPUT_RPS,
} from "@/lib/benchmark-data";

/** Display row after the raw source value has been scaled into chart units. */
type DisplayRow = { framework: string; minimal: number; secure: number };

/** Minimal shape of the tick props Recharts hands a custom category-axis tick. */
type AxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string };
};

/** Pretty framework label; DaloyJS is emphasized so readers can find it fast. */
function frameworkLabel(framework: string): string {
  return framework === "daloy" ? "DaloyJS" : framework;
}

/**
 * Custom y-axis (category) tick for the horizontal bar charts. Bolds the
 * DaloyJS row so it stands out among the comparison frameworks without relying
 * on a per-bar color (the two bars per row already encode minimal vs secure).
 */
function CategoryTick({ x, y, payload }: AxisTickProps) {
  const value = frameworkLabel(payload?.value ?? "");
  const isDaloy = value === "DaloyJS";
  return (
    <text
      x={x}
      y={y}
      dy={4}
      dx={-4}
      textAnchor="end"
      className={cn(
        "text-[11px] fill-muted-foreground",
        isDaloy && "fill-foreground font-semibold"
      )}
    >
      {value}
    </text>
  );
}

/** Two-series config (minimal vs secure parity) shared by the footprint tabs. */
const footprintConfig = {
  minimal: { label: "Minimal", color: "var(--chart-2)" },
  secure: { label: "Secure parity", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** Two-series config for the throughput tab (DaloyJS vs Hono). */
const throughputConfig = {
  daloy: { label: "DaloyJS", color: "var(--primary)" },
  hono: { label: "Hono", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Tooltip value formatter that appends a unit to each number. */
function withUnit(unit: string) {
  return (value: number | string) =>
    typeof value === "number"
      ? `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`
      : String(value);
}

/**
 * Renders one framework comparison as a horizontal grouped bar chart with the
 * two app-shape series (`minimal` / `secure`). Source data is scaled into the
 * chart's display unit before it reaches this component. Horizontal bars keep
 * the framework names readable on narrow (mobile) viewports.
 */
function FootprintBarChart({
  data,
  unit,
  axisFormat,
}: {
  data: DisplayRow[];
  unit: string;
  axisFormat: (value: number) => string;
}) {
  const format = withUnit(unit);
  return (
    <ChartContainer
      config={footprintConfig}
      className="aspect-auto h-[360px] w-full"
    >
      <BarChart
        accessibilityLayer
        layout="vertical"
        data={data}
        margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
        barCategoryGap="22%"
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={axisFormat}
        />
        <YAxis
          type="category"
          dataKey="framework"
          width={68}
          tickLine={false}
          axisLine={false}
          tick={<CategoryTick />}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(label) => frameworkLabel(String(label))}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ background: `var(--color-${name})` }}
                    />
                    {footprintConfig[name as keyof typeof footprintConfig]
                      ?.label ?? name}
                  </span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {format(value as number)}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="minimal"
          fill="var(--color-minimal)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
        />
        <Bar
          dataKey="secure"
          fill="var(--color-secure)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
        />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Renders the DaloyJS-vs-Hono middleware throughput as a horizontal grouped bar
 * chart. Both frameworks run a comparable middleware stack, so the bars come
 * out nearly equal by design: the honest read is "neck and neck", and two bars
 * of almost-equal length show that far more clearly than overlapping areas did.
 */
function ThroughputBarChart() {
  const format = withUnit("req/s");
  return (
    <ChartContainer
      config={throughputConfig}
      className="aspect-auto h-[240px] w-full"
    >
      <BarChart
        accessibilityLayer
        layout="vertical"
        data={MIDDLEWARE_THROUGHPUT_RPS}
        margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
        barCategoryGap="28%"
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 24000]}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
        />
        <YAxis
          type="category"
          dataKey="scenario"
          width={92}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ background: `var(--color-${name})` }}
                    />
                    {throughputConfig[name as keyof typeof throughputConfig]
                      ?.label ?? name}
                  </span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {format(value as number)}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="daloy"
          fill="var(--color-daloy)"
          radius={[0, 4, 4, 0]}
          maxBarSize={26}
        />
        <Bar
          dataKey="hono"
          fill="var(--color-hono)"
          radius={[0, 4, 4, 0]}
          maxBarSize={26}
        />
      </BarChart>
    </ChartContainer>
  );
}

/** Scale raw byte rows into megabytes (2 dp) for the install-footprint chart. */
function toMegabytes(rows: FootprintRow[]): DisplayRow[] {
  return rows.map((r) => ({
    framework: r.framework,
    minimal: Number((r.minimal / 1048576).toFixed(2)),
    secure: Number((r.secure / 1048576).toFixed(2)),
  }));
}

/** Scale raw byte rows into kilobytes (1 dp) for the bundle-size chart. */
function toKilobytes(rows: FootprintRow[]): DisplayRow[] {
  return rows.map((r) => ({
    framework: r.framework,
    minimal: Number((r.minimal / 1024).toFixed(1)),
    secure: Number((r.secure / 1024).toFixed(1)),
  }));
}

/** The four benchmark tabs, each with its own chart + a DaloyJS takeaway. */
const TABS = [
  {
    value: "deps",
    trigger: "Dependencies",
    title: "Transitive dependencies installed",
    description:
      "Every package your install pulls in is attack surface someone has to trust. DaloyJS and Hono are the only two that bring zero.",
    takeaway:
      "DaloyJS installs 0 transitive dependencies, tied with Hono for the smallest supply-chain surface, while a secure NestJS app drags in 86.",
    soWhat:
      "Fewer packages to trust means fewer CVEs and no surprise postinstall scripts. Zero dependencies is zero supply-chain doors left open for an attacker.",
    render: () => (
      <FootprintBarChart
        data={DEPENDENCY_COUNT}
        unit="deps"
        axisFormat={(v) => `${v}`}
      />
    ),
  },
  {
    value: "install",
    trigger: "Install size",
    title: "On-disk install footprint",
    description:
      "Total megabytes written to node_modules for a hello-world app, minimal vs. a security-hardened (secure parity) setup.",
    takeaway:
      "DaloyJS is ~1.3 MB on disk and stays flat when you turn security on, because the hardening is already in-core. Fastify and NestJS balloon once you bolt the equivalent plugins back on.",
    soWhat:
      "Smaller installs mean faster CI runs, leaner Docker images, and quicker cold starts on serverless and the edge.",
    render: () => (
      <FootprintBarChart
        data={toMegabytes(INSTALL_FOOTPRINT_BYTES)}
        unit="MB"
        axisFormat={(v) => `${v}`}
      />
    ),
  },
  {
    value: "bundle",
    trigger: "Bundle size",
    title: "Bundled + gzipped output",
    description:
      "Single-file production build, gzipped. Smaller is faster to ship to the edge and cold-start.",
    takeaway:
      "DaloyJS gzips to ~27 kB minimal and ~31 kB secure, second only to Hono and a fraction of the Express or Nest bundles, despite shipping more batteries by default.",
    soWhat:
      "A smaller bundle boots faster after a cold start, so the first user to hit your edge function or serverless endpoint waits less.",
    render: () => (
      <FootprintBarChart
        data={toKilobytes(BUNDLE_GZIP_BYTES)}
        unit="kB"
        axisFormat={(v) => `${v}`}
      />
    ),
  },
  {
    value: "throughput",
    trigger: "Throughput",
    title: "Requests / second, with a middleware stack",
    description:
      "Both frameworks run a comparable middleware stack on the same routes at 100 connections. This is the fair version of the throughput question: what does it cost once both sides actually do work?",
    takeaway:
      "With comparable middleware on both sides, DaloyJS and Hono are neck and neck, and DaloyJS even edges ahead at ~19.7k vs ~19.3k req/s on static routes. A bare hello-world route would show a much larger gap, but that gap is mostly DaloyJS's security and validation running on every request, work the bare baseline simply skips.",
    soWhat:
      "Security and validation are essentially free at the framework layer. Your real bottleneck will be the database and the network, not DaloyJS.",
    render: () => <ThroughputBarChart />,
  },
] as const;

/**
 * Landing-page benchmark section: a tabbed set of horizontal bar charts
 * comparing DaloyJS against popular Node frameworks, plus an explicit "not
 * apples-to-apples" caveat block. All numbers are sourced from the repo's own
 * `bench/cross-framework` suite (see {@link BENCH_META}). Fully responsive: the
 * tab strip collapses to a 2x2 grid and the charts reflow on small screens.
 */
export function BenchmarkCharts() {
  const [tab, setTab] = React.useState<string>(TABS[0].value);
  const active = TABS.find((t) => t.value === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-6">
      <Card size="sm">
        <CardHeader>
          <CardTitle>How DaloyJS measures up</CardTitle>
          <CardDescription>
            Real numbers from the repo&apos;s own benchmark suite. Pick a
            metric, but keep the caveats below in mind, because none of these
            are a clean apples-to-apples comparison.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.trigger}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent
                key={t.value}
                value={t.value}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold tracking-tight">
                    {t.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                </div>
                {t.render()}
                <p className="text-sm leading-relaxed">
                  <span className="font-semibold text-foreground">
                    What this means for you:{" "}
                  </span>
                  <span className="text-muted-foreground">{t.soWhat}</span>
                </p>
              </TabsContent>
            ))}
          </Tabs>

          <p className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
            <span className="font-semibold text-foreground">Takeaway: </span>
            <span className="text-muted-foreground">{active.takeaway}</span>
          </p>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {BENCH_META.machine} · {BENCH_META.ranAt} · {BENCH_META.coreVersion}{" "}
            · source in <code>{BENCH_META.source}</code>
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Why this is apples to oranges</CardTitle>
          <CardDescription>
            These frameworks are not the same tool, so a head-to-head chart is
            closer to apples vs oranges than a fair race. Here is what these
            numbers do and don&apos;t prove, in plain terms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {BENCH_NOTES.map((note, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60"
                />
                <span className="text-muted-foreground">{note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
