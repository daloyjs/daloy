import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

import { collectHeadings, isRendered } from "../../components/docs-toc";
import { buildPageMarkdown } from "../../lib/page-markdown";

/**
 * Next.js cacheComponents keeps previously visited pages mounted but hidden
 * (React <Activity>: `display: none !important`) inside the same docs article.
 * This fixture is what /docs/installation looked like after visiting
 * /docs/routing first: the old page's nodes are still there, hidden, and one
 * of its ids repeats on the visible page.
 */
const ARTICLE = `
  <article data-docs-content>
    <h1 style="display: none !important;">Routing</h1>
    <h2 id="defining-routes" style="display: none !important;">Defining routes</h2>
    <h2 id="next" style="display: none !important;">Next</h2>
    <h1>Installation</h1>
    <h2 id="prerequisites">Prerequisites</h2>
    <p>Use Node 24.</p>
    <h3 id="install-daloyjs">Install DaloyJS</h3>
    <h2 id="next">Next</h2>
  </article>`;

function article(): Element {
  const { document } = parseHTML(`<html><body>${ARTICLE}</body></html>`);
  return document.querySelector("[data-docs-content]") as unknown as Element;
}

test("TOC collects only the visible page's headings, not hidden cached pages", () => {
  const entries = collectHeadings(article() as unknown as ParentNode);
  assert.deepEqual(entries.map((e) => `${e.level}:${e.id}`), ["2:prerequisites", "3:install-daloyjs", "2:next"]);
});

test("TOC entries point at the visible element even when an id repeats on a hidden page", () => {
  const root = article();
  const next = collectHeadings(root as unknown as ParentNode).find((e) => e.id === "next")!;
  // The first #next in the document is the hidden one; the entry must not be it.
  assert.notEqual(next.element, root.querySelector("#next"));
  assert.equal(isRendered(next.element), true);
  assert.equal(isRendered(root.querySelector("#next")!), false);
});

test("isRendered sees display:none on an ancestor, not just the element", () => {
  const { document } = parseHTML('<div style="display:none"><h2 id="x">X</h2></div><h2 id="y">Y</h2>');
  assert.equal(isRendered(document.querySelector("#x") as unknown as Element), false);
  assert.equal(isRendered(document.querySelector("#y") as unknown as Element), true);
});

test("Copy page leaves hidden cached pages out of the markdown", () => {
  const markdown = buildPageMarkdown(article(), "https://daloyjs.dev/docs/installation");
  assert.match(markdown, /^# Installation/);
  assert.doesNotMatch(markdown, /Routing|Defining routes/);
});
