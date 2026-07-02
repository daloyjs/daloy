/**
 * Pretty startup banner shared by the official starters and easy to drop into
 * any DaloyJS app. Mirrors the visual language of the `create-daloy` CLI so
 * `pnpm dev` / `npm run dev` greets you with the same boxed, colorized panel.
 */

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  gray: "\u001b[90m",
};

const GLYPHS_UNICODE = {
  cornerTL: "\u256D",
  cornerTR: "\u256E",
  cornerBL: "\u2570",
  cornerBR: "\u256F",
  lineH: "\u2500",
  lineV: "\u2502",
  sparkle: "\u2728",
  arrow: "\u25B8",
  mdash: "\u2014",
  mid: "\u00B7",
};

const GLYPHS_ASCII = {
  cornerTL: "+",
  cornerTR: "+",
  cornerBL: "+",
  cornerBR: "+",
  lineH: "-",
  lineV: "|",
  sparkle: "*",
  arrow: ">",
  mdash: "-",
  mid: "-",
};

const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

/** Extra link row rendered in the startup banner (label + URL). */
export interface StartupBannerLink {
  /** Short label shown left-aligned, e.g. `"Swagger UI"`. */
  label: string;
  /** URL printed in the accent color. */
  url: string;
}

/** Options for {@link formatStartupBanner} and {@link printStartupBanner}. */
export interface StartupBannerOptions {
  /** App name shown in the header. Defaults to `"DaloyJS"`. */
  name?: string;
  /** Optional version, e.g. `"1.0.0"`. Printed as `— v1.0.0`. */
  version?: string;
  /** Primary URL, typically `http://localhost:3000`. */
  url: string;
  /** Optional runtime label, e.g. `"Node.js"`, `"Bun"`, `"Deno"`. */
  runtime?: string;
  /** Extra link rows rendered under the primary URL. */
  links?: StartupBannerLink[];
  /** Force color on/off. Defaults to TTY + `NO_COLOR`/`FORCE_COLOR` detection. */
  color?: boolean;
  /** Force ASCII-only glyphs. Defaults to environment detection. */
  ascii?: boolean;
}

/**
 * Read a single environment variable defensively. On runtimes with a
 * capability-based permission model (Deno), reading an env var the process was
 * not granted via `--allow-env` throws a `NotCapable` error. The startup
 * banner is purely cosmetic, so a missing color/locale hint must never crash
 * the host application — swallow the denial and treat the variable as unset.
 * On Node and Bun `process.env` access never throws, so this is a no-op there.
 *
 * @param key - Environment variable name.
 * @returns The value, or `undefined` when unset or inaccessible.
 */
function readEnv(key: string): string | undefined {
  try {
    return process.env[key];
  } catch {
    return undefined;
  }
}

function detectColor(): boolean {
  if (readEnv("NO_COLOR")) return false;
  const force = readEnv("FORCE_COLOR");
  if (force && force !== "0") return true;
  const stdout = process.stdout as { isTTY?: boolean } | undefined;
  return Boolean(stdout && stdout.isTTY);
}

function detectAscii(): boolean {
  if (readEnv("DALOY_ASCII")) return true;
  if (process.platform === "win32") {
    return !(readEnv("WT_SESSION") || readEnv("TERM_PROGRAM"));
  }
  const lang = readEnv("LANG") ?? readEnv("LC_ALL") ?? "";
  if (/UTF-?8/i.test(lang)) return false;
  if (readEnv("TERM_PROGRAM")) return false;
  return true;
}

function paint(useColor: boolean, code: string, text: string): string {
  return useColor ? `${code}${text}${ANSI.reset}` : text;
}

function visibleWidth(s: string): number {
  return s.replace(ANSI_REGEX, "").length;
}

/**
 * Build the multi-line startup banner string without printing it. Useful for
 * tests, custom loggers, or wrapping the output in additional context.
 *
 * @param options Banner content and rendering flags ({@link StartupBannerOptions}).
 * @returns The framed banner as a single string with `\n` line separators.
 */
export function formatStartupBanner(options: StartupBannerOptions): string {
  const useColor = options.color ?? detectColor();
  const useAscii = options.ascii ?? detectAscii();
  const g = useAscii ? GLYPHS_ASCII : GLYPHS_UNICODE;

  const name = options.name ?? "DaloyJS";
  const headerSegments: string[] = [paint(useColor, ANSI.bold + ANSI.yellow, name)];
  if (options.version) {
    headerSegments.push(paint(useColor, ANSI.gray, `${g.mdash} v${options.version}`));
  }
  if (options.runtime) {
    headerSegments.push(paint(useColor, ANSI.dim, `${g.mid} ${options.runtime}`));
  }
  const header = `${paint(useColor, ANSI.cyan, g.sparkle)}  ${headerSegments.join("  ")}`;

  const rows: { label: string; url: string }[] = [
    { label: "Local", url: options.url },
    ...(options.links ?? []),
  ];
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const linkLines = rows.map((r) => {
    const labelText = r.label.padEnd(labelWidth);
    return `${paint(useColor, ANSI.cyan, g.arrow)}  ${paint(useColor, ANSI.bold, labelText)}  ${paint(useColor, ANSI.cyan, r.url)}`;
  });

  const contentLines = [header, "", ...linkLines];
  const contentWidth = Math.max(...contentLines.map(visibleWidth));
  const innerPad = 2;
  const horizontal = g.lineH.repeat(contentWidth + innerPad * 2);
  const accent = useColor ? ANSI.yellow : "";
  const top = paint(useColor, accent, `${g.cornerTL}${horizontal}${g.cornerTR}`);
  const bottom = paint(useColor, accent, `${g.cornerBL}${horizontal}${g.cornerBR}`);
  const side = paint(useColor, accent, g.lineV);

  const boxed = contentLines.map((line) => {
    const padding = " ".repeat(contentWidth - visibleWidth(line));
    return `${side}${" ".repeat(innerPad)}${line}${padding}${" ".repeat(innerPad)}${side}`;
  });

  return [top, ...boxed, bottom].join("\n");
}

/**
 * Print {@link formatStartupBanner} to stdout (or a custom writer). Designed to
 * replace ad-hoc `console.log("listening on …")` calls in starter templates.
 *
 * @param options Banner content and rendering flags ({@link StartupBannerOptions}).
 * @param write Output sink for the banner text. Defaults to `process.stdout.write`.
 */
export function printStartupBanner(
  options: StartupBannerOptions,
  write: (s: string) => void = (s) => process.stdout.write(s),
): void {
  write(`\n${formatStartupBanner(options)}\n\n`);
}
