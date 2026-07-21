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

function jsxTextValue(node: ts.JsxText): string {
  if (node.text.trim()) return node.text;
  return /[\r\n]/u.test(node.text) ? "" : node.text;
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
            !ts.isJsxFragment(child)
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
