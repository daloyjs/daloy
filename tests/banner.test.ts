import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatStartupBanner,
  printStartupBanner,
} from "../src/banner.js";

function strip(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

test("formatStartupBanner: ASCII fallback renders a plain box with label-aligned rows", () => {
  const out = formatStartupBanner({
    name: "MyAPI",
    version: "1.2.3",
    url: "http://localhost:3000",
    runtime: "Node.js",
    links: [
      { label: "Swagger UI", url: "http://localhost:3000/index.html" },
      { label: "Swagger JSON", url: "http://localhost:3000/swagger/v1/swagger.json" },
    ],
    color: false,
    ascii: true,
  });

  assert.ok(out.startsWith("+"));
  assert.ok(out.endsWith("+"));
  assert.match(out, /\* {2}MyAPI {2}- v1\.2\.3 {2}- Node\.js/);
  assert.match(out, />\s+Local\s+\s+http:\/\/localhost:3000/);
  assert.match(out, />\s+Swagger UI\s+\s+http:\/\/localhost:3000\/index\.html/);
  assert.match(out, />\s+Swagger JSON\s+\s+http:\/\/localhost:3000\/swagger\/v1\/swagger\.json/);
  // Box rows all share the same visible width.
  const lines = out.split("\n");
  const widths = new Set(lines.map((l) => l.length));
  assert.equal(widths.size, 1, `expected uniform line widths, got ${[...widths].join(",")}`);
});

test("formatStartupBanner: Unicode + color renders gradient-style glyphs and ANSI codes", () => {
  const out = formatStartupBanner({
    url: "http://localhost:3000",
    color: true,
    ascii: false,
  });

  assert.ok(out.includes("\u256D"), "rounded top-left corner");
  assert.ok(out.includes("\u256F"), "rounded bottom-right corner");
  assert.ok(out.includes("\u2728"), "sparkle glyph");
  assert.ok(out.includes("\u25B8"), "arrow glyph");
  assert.ok(out.includes("\u001b["), "ANSI escape codes present");
  const plain = strip(out);
  assert.match(plain, /DaloyJS/);
  assert.match(plain, /Local\s+\s+http:\/\/localhost:3000/);
});

test("formatStartupBanner: omits version and runtime segments when not provided", () => {
  const out = strip(formatStartupBanner({
    url: "http://localhost:8080",
    color: false,
    ascii: true,
  }));
  assert.ok(!/v\d/.test(out));
  assert.ok(!/Node\.js|Bun|Deno/.test(out));
  assert.match(out, /DaloyJS/);
});

test("formatStartupBanner: does not produce ragged rows for long URLs", () => {
  const out = strip(formatStartupBanner({
    url: `http://localhost:3000/${"very-long-segment/".repeat(20)}`,
    links: [],
    color: false,
    ascii: true,
  }));
  const widths = new Set(out.split("\n").map((line) => line.length));
  assert.equal(widths.size, 1, `expected uniform line widths, got ${[...widths].join(",")}`);
});

test("printStartupBanner: propagates writer errors", () => {
  assert.throws(
    () => printStartupBanner(
      { url: "http://localhost:3000", color: false, ascii: true },
      () => {
        throw new Error("writer failed");
      },
    ),
    /writer failed/,
  );
});

test("detectColor: NO_COLOR forces color off, FORCE_COLOR forces it on", () => {
  const prev = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const off = formatStartupBanner({ url: "http://x", ascii: true });
    assert.ok(!off.includes("\u001b["), "NO_COLOR should disable ANSI codes");

    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const on = formatStartupBanner({ url: "http://x", ascii: true });
    assert.ok(on.includes("\u001b["), "FORCE_COLOR should enable ANSI codes");

    process.env.FORCE_COLOR = "0";
    const off2 = formatStartupBanner({ url: "http://x", ascii: true });
    assert.ok(!off2.includes("\u001b["), "FORCE_COLOR=0 should not force color");
  } finally {
    if (prev.NO_COLOR === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev.NO_COLOR;
    if (prev.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = prev.FORCE_COLOR;
  }
});

test("detectAscii: DALOY_ASCII forces ASCII glyphs, platform Unicode hints keep Unicode", () => {
  const isWindows = process.platform === "win32";
  const prev = {
    DALOY_ASCII: process.env.DALOY_ASCII,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    WT_SESSION: process.env.WT_SESSION,
  };
  // Clear every signal detectAscii() reads so the starting state is a known
  // "no hints" baseline on both the win32 and POSIX code paths.
  const clearAllHints = () => {
    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.TERM_PROGRAM;
    delete process.env.WT_SESSION;
    delete process.env.DALOY_ASCII;
  };
  try {
    clearAllHints();
    process.env.DALOY_ASCII = "1";
    const ascii = formatStartupBanner({ url: "http://x", color: false });
    assert.ok(ascii.includes("+") && !ascii.includes("\u256D"));

    // Drive each platform's actual Unicode trigger so this assertion is
    // meaningful on macOS/Linux AND Windows rather than skipped on one:
    //   - POSIX: a UTF-8 LANG selects Unicode glyphs.
    //   - win32: detectAscii() ignores LANG and keys off WT_SESSION (Windows
    //     Terminal) / TERM_PROGRAM instead.
    clearAllHints();
    if (isWindows) {
      process.env.WT_SESSION = "1";
    } else {
      process.env.LANG = "en_US.UTF-8";
    }
    const utf = formatStartupBanner({ url: "http://x", color: false });
    assert.ok(utf.includes("\u256D"));

    // TERM_PROGRAM selects Unicode on both platforms.
    clearAllHints();
    process.env.TERM_PROGRAM = "vscode";
    const term = formatStartupBanner({ url: "http://x", color: false });
    assert.ok(term.includes("\u256D"));

    // No hints on either platform → ASCII fallback. With WT_SESSION now also
    // cleared, this is a true "no hints" case on Windows too.
    clearAllHints();
    const fallback = formatStartupBanner({ url: "http://x", color: false });
    assert.ok(fallback.includes("+"));
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("printStartupBanner: writes to the supplied writer with leading/trailing newlines", () => {
  const chunks: string[] = [];
  printStartupBanner(
    {
      name: "Test",
      url: "http://localhost:1234",
      color: false,
      ascii: true,
    },
    (s) => chunks.push(s),
  );
  const out = chunks.join("");
  assert.ok(out.startsWith("\n"));
  assert.ok(out.endsWith("\n\n"));
  assert.match(out, /Test/);
});

test("printStartupBanner: defaults to process.stdout.write when no writer is given", () => {
  const original = process.stdout.write.bind(process.stdout);
  const captured: string[] = [];
  (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
    captured.push(s);
    return true;
  };
  try {
    printStartupBanner({
      name: "StdoutTest",
      url: "http://localhost:2345",
      color: false,
      ascii: true,
    });
  } finally {
    (process.stdout as { write: typeof original }).write = original;
  }
  const out = captured.join("");
  assert.match(out, /StdoutTest/);
});

test("formatStartupBanner survives a permission-restricted env (Deno --allow-env denial)", () => {
  // Simulate Deno's capability model: reading a non-granted env var throws
  // NotCapable. The banner is cosmetic and must degrade gracefully, never
  // crash the host app.
  const realEnv = process.env;
  const throwingEnv = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`NotCapable: Requires env access to "${String(prop)}"`);
      },
    },
  );
  try {
    Object.defineProperty(process, "env", { value: throwingEnv, configurable: true });
    let out = "";
    assert.doesNotThrow(() => {
      out = formatStartupBanner({ name: "Svc", url: "http://localhost:3000", runtime: "Deno" });
    });
    // Falls back to no-color, ASCII-safe output that still contains the app name.
    assert.match(strip(out), /Svc/);
  } finally {
    Object.defineProperty(process, "env", { value: realEnv, configurable: true });
  }
});
