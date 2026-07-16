// Terminal formatting helpers for the bench scripts.
//
// Zero dependencies, pure ANSI. Colour is enabled per-stream based on TTY
// detection and honours the de-facto `NO_COLOR` / `FORCE_COLOR` conventions,
// so redirected output (CI logs, `> out.txt`, results files) stays clean while
// an interactive terminal gets a readable, colourful summary.

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function colorEnabled(stream) {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "") return true;
  return Boolean(stream && stream.isTTY);
}

const USE_COLOR_ERR = colorEnabled(process.stderr);
const USE_COLOR_OUT = colorEnabled(process.stdout);

function makePalette(enabled) {
  const wrap = (open, close) => (s) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : String(s);
  return {
    enabled,
    reset: wrap(0, 0),
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    italic: wrap(3, 23),
    underline: wrap(4, 24),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
    white: wrap(97, 39),
  };
}

// `c` colours content written to stderr (headers, live progress, warnings).
export const c = makePalette(USE_COLOR_ERR);
// `cOut` colours content written to stdout (the final summary table).
export const cOut = makePalette(USE_COLOR_OUT);

// Unicode glyphs everywhere — they render fine in modern terminals and in
// redirected UTF-8 logs. Colour is what we gate on TTY, not the glyph.
export const sym = {
  ok: "✓",
  fail: "✗",
  warn: "⚠",
  arrow: "›",
  bullet: "•",
  dot: "·",
};

// Visible (ANSI-stripped) length, for padding cells that contain colour codes.
export function visLen(s) {
  return String(s).replace(ANSI_RE, "").length;
}

function padEndVis(s, width) {
  return s + " ".repeat(Math.max(0, width - visLen(s)));
}

function padStartVis(s, width) {
  return " ".repeat(Math.max(0, width - visLen(s))) + s;
}

// A section header for a single subject (usually a framework run):
//
//   ── daloy ──────────────────────────────────  some note
//
// `note` is rendered dimmed and right of the title.
export function section(title, note) {
  const WIDTH = 58;
  const titleLen = visLen(title);
  const fill = Math.max(3, WIDTH - titleLen - 5);
  const lead = c.cyan("──");
  const tail = c.cyan("─".repeat(fill));
  const titleStr = c.bold(c.white(title));
  const noteStr = note ? "  " + c.dim(note) : "";
  return `\n${lead} ${titleStr} ${tail}${noteStr}`;
}

// A top-level banner printed once at the start of a run.
export function banner(title, subtitle) {
  const line = c.cyan("━".repeat(60));
  const head = `${c.bold(c.cyan(title))}`;
  const sub = subtitle ? `\n${c.dim(subtitle)}` : "";
  return `${line}\n${head}${sub}\n${line}`;
}

// Status line helpers (return strings; caller decides the stream).
export const ok = (msg) => `${c.green(sym.ok)} ${msg}`;
export const fail = (msg) => `${c.red(sym.fail)} ${c.red(msg)}`;
export const warn = (msg) => `${c.yellow(sym.warn)} ${c.yellow(msg)}`;
export const info = (msg) => `${c.cyan(sym.arrow)} ${msg}`;

// A dim "key=value" metric chip, e.g. p99=1.20ms. `value` is highlighted.
export function metric(key, value, { unit = "", color = c.white } = {}) {
  return `${c.dim(key)} ${color(value)}${unit ? c.dim(unit) : ""}`;
}

// Join metric chips with a dim middle-dot separator, indented two spaces.
export function metricsLine(label, chips, { labelWidth = 22 } = {}) {
  const sep = c.dim(`  ${sym.dot}  `);
  return `  ${c.gray(sym.bullet)} ${c.white(padEndVis(label, labelWidth))} ${chips.join(sep)}`;
}

// Pretty box-drawing table for the terminal summary (stdout).
//   head:      array of column titles
//   rows:      array of row arrays (plain strings; coloured internally)
//   align:     array of "l" | "r" (default: col 0 left, the rest right)
//   highlight: optional (row, index) => boolean; matching rows are emphasised
export function table({ head, rows, align, highlight }) {
  const cols = head.length;
  const al = (i) => (align && align[i]) || (i === 0 ? "l" : "r");
  const widths = head.map((h, i) =>
    Math.max(visLen(h), ...rows.map((r) => visLen(String(r[i] ?? "")))),
  );

  const b = cOut.gray; // border colour
  const top = b("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");
  const mid = b("├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤") ;
  const bot = b("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");
  const bar = b("│");

  const renderCell = (raw, i, color) => {
    const text = color ? color(raw) : raw;
    const padded = al(i) === "r" ? padStartVis(text, widths[i]) : padEndVis(text, widths[i]);
    return ` ${padded} `;
  };

  const headLine =
    bar + head.map((h, i) => renderCell(h, i, cOut.bold)).join(bar) + bar;

  const bodyLines = rows.map((r, ri) => {
    const emphasise = highlight && highlight(r, ri);
    const cellColor = emphasise ? (s) => cOut.bold(cOut.cyan(s)) : undefined;
    return bar + r.map((cell, i) => renderCell(String(cell ?? ""), i, cellColor)).join(bar) + bar;
  });

  return [top, headLine, mid, ...bodyLines, bot].join("\n");
}

// Plain GitHub-flavoured Markdown table (no colour) for pasting into docs.
export function mdTable({ head, rows, align }) {
  const al = (i) => (align && align[i]) || (i === 0 ? "l" : "r");
  const widths = head.map((h, i) =>
    Math.max(h.length, 3, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const pad = (s, i) =>
    al(i) === "r" ? String(s).padStart(widths[i]) : String(s).padEnd(widths[i]);
  const sep = (i) => {
    const dashes = "-".repeat(widths[i]);
    if (al(i) === "r") return dashes.slice(0, -1) + ":";
    if (al(i) === "c") return ":" + dashes.slice(1, -1) + ":";
    return dashes;
  };
  const lines = [
    "| " + head.map((h, i) => pad(h, i)).join(" | ") + " |",
    "| " + head.map((_, i) => sep(i)).join(" | ") + " |",
    ...rows.map((r) => "| " + r.map((cell, i) => pad(cell ?? "", i)).join(" | ") + " |"),
  ];
  return lines.join("\n");
}

// Render a summary: pretty table to the terminal, plus the Markdown version
// underneath (dimmed heading) so docs copy-paste still works.
export function summary({ head, rows, align, highlight, mdAlign }) {
  const pretty = table({ head, rows, align, highlight });
  const md = mdTable({ head, rows, align: mdAlign ?? align });
  return `${pretty}\n\n${c.dim("Markdown (paste into docs):")}\n${md}`;
}

// Render parity tiers (see common.mjs parityTiers()) as the primary,
// rank-honest view of a result set: frameworks in the same tier are
// statistically indistinguishable, so a table row being "first" inside a
// tier is noise, not a win.
//
//   title:     metric label, e.g. "GET /static (req/s)"
//   better:    "higher" | "lower" — echoed in the legend
//   fmtValue:  formats each entry's value (default String)
//   highlight: optional (name) => boolean; matches are emphasised
export function renderTiers(tiers, { title, better = "higher", fmtValue = String, highlight } = {}) {
  const lines = [
    cOut.bold(`Parity tiers — ${title}`) +
      cOut.dim(` (${better} is better; overlapping 95% CIs ⇒ same tier)`),
  ];
  tiers.forEach((tier, i) => {
    const members = tier.map((e) => {
      const name = highlight && highlight(e.name) ? cOut.bold(cOut.cyan(e.name)) : cOut.white(e.name);
      const ci = e.ci95 != null ? cOut.dim(` ±${fmtValue(e.ci95)}`) : "";
      return `${name} ${fmtValue(e.value)}${ci}`;
    });
    lines.push(`  ${cOut.bold(String(i + 1) + ".")} ${members.join(cOut.dim("  ·  "))}`);
  });
  return lines.join("\n");
}
