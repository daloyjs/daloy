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

test("buildPageMarkdown skips JSON-LD script tags", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <h1>About</h1>
      <p>Hello.</p>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/about"),
    "# About\n\nHello.\n\n---\n\nSource: https://daloyjs.dev/about",
  );
});

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

test("buildPageMarkdown leaves prose punctuation unescaped", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <div>
        A fresh App instance ships these defaults armed (new App()). Each one has a
        per-feature opt-out, and secureDefaults: false is the master escape hatch.
      </div>
    </article>
  `);

  const markdown = buildPageMarkdown(article, "https://daloyjs.dev/docs/sample");

  assert.ok(
    !markdown.includes("\\"),
    `expected no backslash escapes, got: ${JSON.stringify(markdown)}`,
  );
  assert.match(markdown, /armed \(new App\(\)\)\. Each one has a per-feature opt-out/);
});

test("buildPageMarkdown keeps inline runs in a single paragraph", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <blockquote>
        Security defaults start enabled. Disabling them requires both
        <code>secureDefaults: false</code> and <code>acknowledgeInsecureDefaults: true</code>,
        and DaloyJS records the choice at startup.
      </blockquote>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/docs/sample"),
    [
      "> Security defaults start enabled. Disabling them requires both " +
        "`secureDefaults: false` and `acknowledgeInsecureDefaults: true`, " +
        "and DaloyJS records the choice at startup.",
      "",
      "---",
      "",
      "Source: https://daloyjs.dev/docs/sample",
    ].join("\n"),
  );
});

test("buildPageMarkdown separates adjacent inline elements and drops decorations", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <ul>
        <li><span>✓</span><span>Protecting credential entry against brute-force attacks.</span></li>
      </ul>
      <p><span aria-hidden="true">→</span>Visible copy.</p>
    </article>
  `);

  const markdown = buildPageMarkdown(article, "https://daloyjs.dev/docs/sample");

  assert.match(markdown, /^- ✓ Protecting credential entry against brute-force attacks\.$/m);
  assert.match(markdown, /^Visible copy\.$/m);
});

test("buildPageMarkdown escapes only a paragraph's leading block marker", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <p>- not a list item, and 2 - 1 stays intact</p>
      <p>#hashtags are not headings</p>
    </article>
  `);

  const markdown = buildPageMarkdown(article, "https://daloyjs.dev/docs/sample");

  assert.match(markdown, /^\\- not a list item, and 2 - 1 stays intact$/m);
  assert.match(markdown, /^#hashtags are not headings$/m);
});

test("buildPageMarkdown indents extra blocks inside a list item", () => {
  const article = articleFromHtml(`
    <article data-docs-content>
      <ul>
        <li>
          <p>Register the hook.</p>
          <div class="code-editor" data-language="ts">
            <div class="code-editor__content"><pre><code>app.use(cors());</code></pre></div>
          </div>
        </li>
      </ul>
    </article>
  `);

  assert.equal(
    buildPageMarkdown(article, "https://daloyjs.dev/docs/sample"),
    [
      "- Register the hook.",
      "",
      "  ```ts",
      "  app.use(cors());",
      "  ```",
      "",
      "---",
      "",
      "Source: https://daloyjs.dev/docs/sample",
    ].join("\n"),
  );
});
