import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { buildPageMarkdown } from "../../lib/page-markdown";

/**
 * Parse an HTML fragment the same way the `.md` docs endpoint does and return
 * the `[data-docs-content]` article element.
 */
function articleFromHtml(html: string): Element {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const article = document.querySelector("[data-docs-content]");

  assert.ok(article, "fixture must contain a [data-docs-content] element");

  return article as unknown as Element;
}

test("buildPageMarkdown converts headings, paragraphs, and inline markup", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <h1>Routing</h1>
      <p>Routes are <strong>type-safe</strong> and use <code>app.route()</code> under the hood.</p>
      <h2 id="defining-routes">Defining routes</h2>
      <p>See the <a href="/docs/openapi">OpenAPI page</a> for <em>generated</em> specs.</p>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/docs/routing"),
    [
      "# Routing",
      "",
      "Routes are **type-safe** and use `app.route()` under the hood.",
      "",
      "## Defining routes",
      "",
      "See the [OpenAPI page](/docs/openapi) for *generated* specs.",
      "",
      "---",
      "",
      "Source: https://daloyjs.dev/docs/routing",
    ].join("\n"),
  );
});

test("buildPageMarkdown fences code-editor blocks with their language", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <div class="code-editor" data-language="ts">
        <div class="code-editor__toolbar"><span>ts</span><button>Copy</button></div>
        <div class="code-editor__content"><pre><code>const answer = 42;</code></pre></div>
      </div>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/docs/sample"),
    "```ts\nconst answer = 42;\n```\n\n---\n\nSource: https://daloyjs.dev/docs/sample",
  );
});

test("buildPageMarkdown converts lists and tables, and skips svg diagrams", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <ul>
        <li>First</li>
        <li>Second
          <ol><li>Nested</li></ol>
        </li>
      </ul>
      <svg viewBox="0 0 10 10"><text>diagram label</text></svg>
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>timeout</td><td>30s</td></tr></tbody>
      </table>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/docs/sample"),
    [
      "- First",
      "- Second",
      "  1. Nested",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| timeout | 30s |",
      "",
      "---",
      "",
      "Source: https://daloyjs.dev/docs/sample",
    ].join("\n"),
  );
});

test("buildPageMarkdown returns an empty string for empty articles", () => {
  const article = articleFromHtml(`<article data-docs-content></article>`);

  assert.equal(buildPageMarkdown(article, "https://daloyjs.dev/docs/sample"), "");
});
