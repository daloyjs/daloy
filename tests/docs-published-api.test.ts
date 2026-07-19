import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();
const DOCS_ROOT = path.join(REPO_ROOT, "website", "app", "docs");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};
const JSR_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, "jsr.json"), "utf8")) as {
  exports: Record<string, string>;
};

function collectDocsPages(directory: string): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...collectDocsPages(absolute));
    } else if (entry.name === "page.tsx") {
      pages.push(absolute);
    }
  }
  return pages;
}

const docsPages = collectDocsPages(DOCS_ROOT);
const IS_COMPILED_COVERAGE = import.meta.url.includes("/dist-coverage/tests/");

function executableModulePath(sourceTarget: string): string {
  if (!IS_COMPILED_COVERAGE) return path.join(REPO_ROOT, sourceTarget);
  const compiledTarget = sourceTarget.replace(/^\.\/src\//, "").replace(/\.ts$/, ".js");
  return path.join(REPO_ROOT, "dist-coverage", "src", compiledTarget);
}

test("documented @daloyjs/core package imports resolve through the published exports map", () => {
  const importPattern = /\bfrom\s+["'](@daloyjs\/core(?:\/[^"'`]+)?)["']/g;

  for (const page of docsPages) {
    const source = readFileSync(page, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]!;
      const subpath =
        specifier === "@daloyjs/core" ? "." : `./${specifier.slice("@daloyjs/core/".length)}`;
      assert.ok(
        Object.hasOwn(PACKAGE_JSON.exports, subpath),
        `${path.relative(REPO_ROOT, page)} documents unpublished package subpath "${specifier}"`
      );
    }
  }
});

test("documented runtime imports name real public exports", async () => {
  const importPattern =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](@daloyjs\/core(?:\/[^"']+)?)['"]/g;

  for (const page of docsPages) {
    const source = readFileSync(page, "utf8");
    for (const match of source.matchAll(importPattern)) {
      if (match[1]) continue;
      const specifier = match[3]!;
      const subpath =
        specifier === "@daloyjs/core" ? "." : `./${specifier.slice("@daloyjs/core/".length)}`;
      const sourceTarget = JSR_JSON.exports[subpath];
      assert.ok(sourceTarget, `${specifier} must resolve through jsr.json`);
      const publicModule = (await import(
        pathToFileURL(executableModulePath(sourceTarget)).href
      )) as Record<string, unknown>;

      for (const rawImport of match[2]!.split(",")) {
        const imported = rawImport
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/g, "")
          .trim();
        if (!imported || imported.startsWith("type ")) continue;
        const exportName = imported.split(/\s+as\s+/)[0]!.trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(exportName)) continue;
        assert.ok(
          Object.hasOwn(publicModule, exportName),
          `${path.relative(REPO_ROOT, page)} documents missing runtime export "${exportName}" from "${specifier}"`
        );
      }
    }
  }
});

test("AI SDK docs wire the exported logger instead of a nonexistent middleware", () => {
  const source = readFileSync(path.join(DOCS_ROOT, "ai-sdk", "page.tsx"), "utf8");
  assert.doesNotMatch(source, /\bstructuredLogger\b/);
  assert.match(source, /\bcreateLogger\b/);
  assert.match(source, /logger:\s*createLogger\(/);
});

test("payment webhook docs use bounded raw-body reads from the root package", () => {
  const providers = [
    "authorize-net",
    "mollie",
    "paytabs",
    "razorpay",
    "shopify",
    "square",
    "stripe",
  ];

  for (const provider of providers) {
    const source = readFileSync(path.join(DOCS_ROOT, "payments", provider, "page.tsx"), "utf8");
    assert.doesNotMatch(source, /@daloyjs\/core\/raw|\breadRawBody\b/);
    assert.match(source, /readBodyLimited\(request,\s*1_048_576\)/);
  }
});
