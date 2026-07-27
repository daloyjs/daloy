import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

import { BranchDiagram, FlowDiagram, LayerStack, SequenceDiagram } from "../../components/diagram";
import { buildPageMarkdown } from "../../lib/page-markdown";

/**
 * Render a real diagram component to static HTML and convert it with the same
 * converter the `.md` endpoint and the "Copy page" button use, returning the
 * markdown body without the trailing `Source:` attribution.
 *
 * The components are rendered rather than hand-written as fixtures so the
 * `data-diagram-*` contract between [diagram.tsx](../../components/diagram.tsx)
 * and [page-markdown.ts](../../lib/page-markdown.ts) is exercised end to end: a
 * dropped attribute fails these tests instead of silently flattening 89 docs
 * pages into run-together text.
 */
function diagramMarkdown(element: ReactElement): string {
  const { document } = parseHTML(
    `<html><body><article data-docs-content>${renderToStaticMarkup(element)}</article></body></html>`,
  );
  const article = document.querySelector("[data-docs-content]");

  assert.ok(article, "rendered diagram must be inside the docs article");

  return buildPageMarkdown(
    article as unknown as Element,
    "https://daloyjs.dev/docs/sample",
  ).replace(/\n\n---\n\nSource: .*$/, "");
}

test("FlowDiagram converts to a titled ordered list with captions", () => {
  const markdown = diagramMarkdown(
    createElement(FlowDiagram, {
      title: "Cross-origin write admission",
      caption: "Read-only methods and same-origin requests are never affected.",
      numbered: true,
      steps: [
        {
          eyebrow: "ingress",
          label: "Cross-origin POST/PUT/PATCH/DELETE",
          detail: "Origin differs from request URL",
        },
        {
          eyebrow: "guard",
          label: "cors() allows the origin?",
          detail: "matched route policy decides",
        },
        {
          eyebrow: "no policy",
          label: "Rejected",
          detail: "403 application/problem+json",
          tone: "danger",
        },
      ],
    }),
  );

  assert.equal(
    markdown,
    [
      "**Diagram: Cross-origin write admission**",
      "",
      "1. **Cross-origin POST/PUT/PATCH/DELETE** (ingress) - Origin differs from request URL",
      "2. **cors() allows the origin?** (guard) - matched route policy decides",
      "3. **Rejected** (no policy) - 403 application/problem+json",
      "",
      "Read-only methods and same-origin requests are never affected.",
    ].join("\n"),
  );
});

test("FlowDiagram without indices converts to a bullet list", () => {
  const markdown = diagramMarkdown(
    createElement(FlowDiagram, {
      steps: [{ label: "request" }, { label: "handler" }],
    }),
  );

  assert.equal(markdown, ["- **request**", "- **handler**"].join("\n"));
});

test("SequenceDiagram keeps participants, direction, and payload separate", () => {
  const markdown = diagramMarkdown(
    createElement(SequenceDiagram, {
      title: "Token exchange",
      participants: ["client", "gateway", "authz"],
      steps: [
        {
          from: "client",
          to: "gateway",
          label: "request a token",
          detail: "POST /token",
        },
        {
          from: "gateway",
          to: "client",
          label: "token issued",
          kind: "response",
          detail: "200 application/json",
        },
      ],
    }),
  );

  assert.equal(
    markdown,
    [
      "**Diagram: Token exchange**",
      "",
      "Participants: client, gateway, authz",
      "",
      "1. **client -> gateway** (request) - request a token - POST /token",
      "2. **gateway -> client** (response) - token issued - 200 application/json",
    ].join("\n"),
  );
});

test("BranchDiagram labels the source, branches, and converge node", () => {
  const markdown = diagramMarkdown(
    createElement(BranchDiagram, {
      title: "Single source codegen",
      source: { label: "route definition", detail: "app.get(...)" },
      branches: [{ label: "OpenAPI" }, { label: "typed client", detail: "client/" }],
      converge: { label: "contract tests" },
    }),
  );

  assert.equal(
    markdown,
    [
      "**Diagram: Single source codegen**",
      "",
      "- **route definition** (source) - app.get(...)",
      "- **OpenAPI**",
      "- **typed client** - client/",
      "- **contract tests** (converge)",
    ].join("\n"),
  );
});

test("LayerStack lists each layer with its detail and items", () => {
  const markdown = diagramMarkdown(
    createElement(LayerStack, {
      title: "Module boundaries",
      layers: [
        { title: "app", detail: "composition root", items: ["App", "routes"] },
        { title: "shared kernel", detail: "no imports upward" },
      ],
    }),
  );

  assert.equal(
    markdown,
    [
      "**Diagram: Module boundaries**",
      "",
      "- **app** - composition root - [App, routes]",
      "- **shared kernel** - no imports upward",
    ].join("\n"),
  );
});

test("diagram markdown carries no escaping artifacts or run-together labels", () => {
  const markdown = diagramMarkdown(
    createElement(FlowDiagram, {
      title: "What new App() arms for you",
      numbered: true,
      steps: [
        {
          eyebrow: "construction",
          label: "new App()",
          detail: "no middleware calls required",
        },
        {
          eyebrow: "secureHeaders() auto-applied",
          label: "HSTS, frame DENY, nosniff",
          detail: "baseline CSP",
        },
      ],
    }),
  );

  assert.ok(!markdown.includes("\\"), `unexpected escape in: ${markdown}`);
  assert.doesNotMatch(markdown, /\b0\d[a-zA-Z]/);
  assert.match(
    markdown,
    /^1\. \*\*new App\(\)\*\* \(construction\) - no middleware calls required$/m,
  );
});
