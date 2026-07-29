import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const CONTENT_ROOTS = ["app/docs", "app/blog"];
const PROSE_TAGS = new Set([
  "a",
  "blockquote",
  "button",
  "caption",
  "dd",
  "dt",
  "em",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "p",
  "small",
  "span",
  "strong",
  "summary",
  "td",
  "th",
]);

interface TextEdge {
  first: string;
  last: string;
  leadingSpace: boolean;
  trailingSpace: boolean;
}

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

/**
 * Collapse a `JsxText` node the way the JSX transform does, so the edges this
 * test inspects are the ones React actually receives.
 *
 * This matters because source formatting is not rendered output. Prettier wraps
 * prose, so `<code>x</code>\n        ), more` reaches the compiler as a text
 * node whose raw value *starts* with a newline and indentation — yet JSX strips
 * that, emitting `"), more"` with no leading space. Comparing raw edges made
 * every wrapped line look like a spacing defect: the check reported 559
 * violations across 128 of 187 pages while the rendered HTML contained none.
 *
 * The algorithm is the JSX text-collapsing rule as implemented by both TSC and
 * Babel: split on newlines, strip leading whitespace from every line except the
 * first and trailing whitespace from every line except the last, drop the lines
 * that are then empty, and join the rest with a single space. A whitespace-only
 * node containing a newline collapses to nothing (so indentation between
 * elements disappears), while a whitespace-only node on one line survives (so
 * the deliberate space in `<b>a</b> <i>b</i>` is preserved).
 *
 * @param node - The `JsxText` node to collapse.
 * @returns The text React receives, or `""` when JSX drops the node entirely.
 */
function jsxTextValue(node: ts.JsxText): string {
  const lines = node.text.split(/\r\n|\n|\r/u);

  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/u.test(lines[i])) lastNonEmptyLine = i;
  }

  let collapsed = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/gu, " ");
    if (i !== 0) line = line.replace(/^ +/u, "");
    if (i !== lines.length - 1) line = line.replace(/ +$/u, "");
    if (!line) continue;
    collapsed += i === lastNonEmptyLine ? line : `${line} `;
  }
  return collapsed;
}

function renderedLiteral(node: ts.JsxChild): string | null {
  if (ts.isJsxText(node)) return jsxTextValue(node);

  if (ts.isJsxExpression(node)) {
    const expression = node.expression;
    if (
      expression &&
      (ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression))
    ) {
      return expression.text;
    }
    return null;
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    let value = "";
    for (const child of node.children) {
      const childValue = renderedLiteral(child);
      if (childValue !== null) value += childValue;
    }
    return value;
  }

  return null;
}

function textEdge(value: string): TextEdge | null {
  if (!value.trim()) return null;

  return {
    first: value.trimStart()[0],
    last: value.trimEnd().at(-1) ?? "",
    leadingSpace: /^\s/u.test(value),
    trailingSpace: /\s$/u.test(value),
  };
}

function tagName(node: ts.JsxElement, source: ts.SourceFile): string {
  return node.openingElement.tagName.getText(source);
}

function isIntentionalCodeSuffix(
  previous: ts.JsxChild,
  currentValue: string,
  source: ts.SourceFile,
): boolean {
  return (
    ts.isJsxElement(previous) &&
    tagName(previous, source) === "code" &&
    /^(?:s|ing)(?=\b|[).,;:!?])/u.test(currentValue.trimStart())
  );
}

/**
 * An ellipsis after a space is correct prose, not punctuation crowding the word
 * before it: enumerations such as `<code>a</code>, <code>b</code>, ...)` are
 * meant to read with that space. Without this exception the space-before-
 * punctuation rule fires on the leading `.` of every `...`.
 *
 * @param currentValue - The collapsed text following the space.
 * @returns `true` when the text opens with an ellipsis.
 */
function isEllipsis(currentValue: string): boolean {
  return /^(?:\.\.\.|…)/u.test(currentValue.trimStart());
}

function spacingViolations(file: string): string[] {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) && PROSE_TAGS.has(tagName(node, source))) {
      let previous: { child: ts.JsxChild; edge: TextEdge } | null = null;
      let pendingSpace = false;

      for (const child of node.children) {
        const value = renderedLiteral(child);
        if (value === null) {
          previous = null;
          pendingSpace = false;
          continue;
        }

        const edge = textEdge(value);
        if (!edge) {
          if (previous && /\s/u.test(value)) pendingSpace = true;
          continue;
        }

        if (previous) {
          const hasSpace =
            previous.edge.trailingSpace || pendingSpace || edge.leadingSpace;
          const line =
            source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1;
          const location = `${relative(process.cwd(), file)}:${line}`;

          if (
            !hasSpace &&
            /[\p{L}\p{N}.!?,;:)}\]]/u.test(previous.edge.last) &&
            /[\p{L}\p{N}]/u.test(edge.first) &&
            !isIntentionalCodeSuffix(previous.child, value, source)
          ) {
            violations.push(`${location} is missing a space between inline nodes`);
          }

          if (
            hasSpace &&
            /[.,;:!?)}\]]/u.test(edge.first) &&
            !ts.isJsxElement(child) &&
            !ts.isJsxFragment(child) &&
            !isEllipsis(value)
          ) {
            violations.push(`${location} has whitespace before punctuation`);
          }

          if (hasSpace && /[(\[{]/u.test(previous.edge.last)) {
            violations.push(
              `${location} has whitespace after opening punctuation`,
            );
          }
        }

        previous = { child, edge };
        pendingSpace = false;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

test("docs and blog JSX preserve prose spacing across inline tags", () => {
  const violations = CONTENT_ROOTS.flatMap((root) =>
    pageFiles(root).flatMap(spacingViolations),
  );

  assert.deepEqual(violations, []);
});
