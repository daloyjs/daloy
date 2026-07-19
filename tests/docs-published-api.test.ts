import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DOCS_ROOT = path.join(REPO_ROOT, "website", "app", "docs");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
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
