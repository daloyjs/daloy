import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Callout } from "../../components/callout";
import { parseLineSpec, stripNotation } from "../../components/code-block";
import { assistantLinks } from "../../components/docs-page-copy-button";
import { installCommands } from "../../components/package-install";
import { sourceFileForRoute } from "../../lib/git-dates";
import { buildPageMarkdown } from "../../lib/page-markdown";

function markdownOf(inner: string): string {
  const { document } = parseHTML(`<html><body><article data-docs-content>${inner}</article></body></html>`);
  const article = document.querySelector("[data-docs-content]") as unknown as Element;
  return buildPageMarkdown(article, "https://daloyjs.dev/docs/x").split("\n\n---\n\n")[0] ?? "";
}

test("parseLineSpec expands numbers and inclusive ranges", () => {
  assert.deepEqual([...parseLineSpec("1,3-5, 9")], [1, 3, 4, 5, 9]);
  assert.deepEqual([...parseLineSpec(undefined)], []);
});

test("parseLineSpec ignores malformed parts, reversed ranges and caps huge ranges", () => {
  assert.deepEqual([...parseLineSpec("a,2-x,7-3,,4")], [4]);
  assert.equal(parseLineSpec("1-999999").size, 1000);
});

test("stripNotation removes Shiki markers so copied code is clean", () => {
  const code = [
    "const a = 1; // [!code ++]",
    "const b = 2; // [!code --]",
    "# [!code focus]",
    "echo hi # [!code highlight]",
    "keep(this)",
  ].join("\n");
  assert.equal(stripNotation(code), "const a = 1;\nconst b = 2;\n\necho hi\nkeep(this)");
  // Ordinary comments survive.
  assert.equal(stripNotation("x() // normal comment"), "x() // normal comment");
});

test("installCommands renders each package manager, with dev flags", () => {
  assert.deepEqual(installCommands("@daloyjs/core  zod"), {
    pnpm: "pnpm add @daloyjs/core zod",
    npm: "npm install @daloyjs/core zod",
    yarn: "yarn add @daloyjs/core zod",
    bun: "bun add @daloyjs/core zod",
  });
  assert.equal(installCommands("tsx", true).npm, "npm install --save-dev tsx");
  assert.equal(installCommands("tsx", true).pnpm, "pnpm add -D tsx");
});

test("assistantLinks only carries the public page URL in the query", () => {
  const links = assistantLinks("https://daloyjs.dev/docs/routing.md");
  const chat = new URL(links.chatgpt);
  const claude = new URL(links.claude);
  assert.equal(chat.origin, "https://chatgpt.com");
  assert.equal(claude.origin, "https://claude.ai");
  assert.equal(claude.searchParams.get("q"), "Read https://daloyjs.dev/docs/routing.md, I want to ask questions about it.");
});

test("Callout renders an aside that exports as a GitHub alert", () => {
  const html = renderToStaticMarkup(
    createElement(Callout, { type: "warning", title: "Heads up", children: createElement("p", null, "Mind the gap.") }),
  );
  assert.match(html, /^<aside role="note" data-callout="warning"/);
  assert.equal(markdownOf(html), "> [!WARNING]\n> **Heads up**\n> Mind the gap.");
});

test("Callout without a custom title exports only the alert marker", () => {
  const html = renderToStaticMarkup(createElement(Callout, { type: "tip", children: createElement("p", null, "Use pnpm.") }));
  assert.equal(markdownOf(html), "> [!TIP]\n> Use pnpm.");
});

test("markdown export keeps code titles and skips alternate tab panels", () => {
  const block = (lang: string, code: string, title?: string) =>
    `<div class="code-editor" data-language="${lang}"><div>${title ? `<span data-code-title>${title}</span>` : ""}</div><pre><code>${code}</code></pre></div>`;
  const md = markdownOf(
    block("ts", "app.listen()", "src/app.ts") +
      `<div role="tabpanel">${block("bash", "pnpm add x")}</div>` +
      `<div role="tabpanel" hidden data-md-skip>${block("bash", "npm install x")}</div>`,
  );
  assert.equal(md, '```ts title="src/app.ts"\napp.listen()\n```\n\n```bash\npnpm add x\n```');
  assert.ok(!md.includes("npm install"));
});

test("sourceFileForRoute resolves docs pages and rejects unknown routes", () => {
  assert.equal(sourceFileForRoute("/docs/routing"), "app/docs/routing/page.tsx");
  assert.equal(sourceFileForRoute("/docs"), "app/docs/page.tsx");
  assert.equal(sourceFileForRoute("/docs/does-not-exist"), null);
});
