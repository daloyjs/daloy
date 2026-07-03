/**
 * Shared DOM → markdown converter for rendered docs pages.
 *
 * The same converter runs against the same markup in two places:
 *
 * - in the browser, powering the docs "Copy page" button
 *   ([docs-page-copy-button.tsx](../components/docs-page-copy-button.tsx))
 * - on the server, powering the `.md` docs endpoint
 *   (`app/docs-md/[[...slug]]/route.ts`), where the prerendered page HTML is
 *   parsed with linkedom
 *
 * To stay isomorphic it never touches browser globals (`window`, `document`,
 * `HTMLElement`, the `Node` constructor). Nodes are duck-typed via `nodeType`
 * and `tagName` instead of `instanceof` checks so both real DOM nodes and
 * linkedom nodes convert identically.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

/**
 * Returns the lowercase tag name for element nodes, or `null` for anything
 * else (text, comments) and for SVG subtrees, which the converter skips the
 * same way the original `instanceof HTMLElement` checks did in the browser.
 */
function convertibleTagName(node: Node): string | null {
  if (!isElement(node)) {
    return null;
  }

  const tagName = node.tagName.toLowerCase();
  return tagName === "svg" ? null : tagName;
}

function escapeInlineMarkdown(text: string) {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function escapeTableCell(text: string) {
  return text.replace(/\|/g, "\\|");
}

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ");
}

function trimBlankLines(text: string) {
  return text.replace(/^\n+|\n+$/g, "");
}

function inlineNodesToMarkdown(nodes: Node[]) {
  return normalizeInlineMarkdown(nodes.map((node) => inlineNodeToMarkdown(node)).join(""));
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    return collapseWhitespace(node.textContent ?? "");
  }

  const tagName = convertibleTagName(node);

  if (tagName === null || !isElement(node)) {
    return "";
  }

  if (node.classList.contains("code-editor")) {
    return "";
  }

  if (tagName === "br") {
    return "  \n";
  }

  if (tagName === "code" && !node.closest("pre")) {
    return `\`${trimBlankLines(node.textContent ?? "")}\``;
  }

  if (tagName === "a") {
    const text = inlineNodesToMarkdown(Array.from(node.childNodes)).trim() || (node.textContent ?? "").trim();
    const href = node.getAttribute("href") ?? "";

    return href ? `[${text}](${href})` : text;
  }

  if (tagName === "strong" || tagName === "b") {
    return `**${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}**`;
  }

  if (tagName === "em" || tagName === "i") {
    return `*${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}*`;
  }

  return Array.from(node.childNodes)
    .map((child) => inlineNodeToMarkdown(child))
    .join("");
}

function normalizeInlineMarkdown(text: string) {
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

function codeBlockToMarkdown(element: Element) {
  const language = element.getAttribute("data-language") ?? "text";
  const pre = element.querySelector("pre");
  const code = trimBlankLines(pre?.textContent ?? "");
  const fence = language === "text" ? "```" : `\`\`\`${language}`;

  return code ? `${fence}\n${code}\n\`\`\`` : "";
}

function tableToMarkdown(table: Element) {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td")).map((cell) =>
        escapeTableCell(inlineNodesToMarkdown(Array.from(cell.childNodes)).trim())
      )
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const cells = [...row];

    while (cells.length < columnCount) {
      cells.push("");
    }

    return `| ${cells.join(" | ")} |`;
  });

  const separator = `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;

  return [normalizedRows[0], separator, ...normalizedRows.slice(1)].join("\n");
}

function listToMarkdown(list: Element, depth = 0) {
  const ordered = list.tagName.toLowerCase() === "ol";

  return Array.from(list.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((item, index) => listItemToMarkdown(item, ordered ? `${index + 1}.` : "-", depth))
    .join("\n");
}

function listItemToMarkdown(item: Element, marker: string, depth: number) {
  const nestedBlocks: string[] = [];
  const contentParts: Node[] = [];

  Array.from(item.childNodes).forEach((child) => {
    const tagName = convertibleTagName(child);

    if (tagName === "ul" || tagName === "ol") {
      nestedBlocks.push(listToMarkdown(child as Element, depth + 1));
      return;
    }

    contentParts.push(child);
  });

  const indent = "  ".repeat(depth);
  const content = inlineNodesToMarkdown(contentParts).trim();
  const lines = [`${indent}${marker} ${content}`.trimEnd()];

  nestedBlocks.filter(Boolean).forEach((block) => {
    lines.push(block);
  });

  return lines.join("\n");
}

function blockNodeToMarkdown(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    const text = collapseWhitespace(node.textContent ?? "").trim();
    return text ? escapeInlineMarkdown(text) : "";
  }

  const tagName = convertibleTagName(node);

  if (tagName === null || !isElement(node)) {
    return "";
  }

  if (node.classList.contains("code-editor")) {
    return codeBlockToMarkdown(node);
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName[1]);
    return `${"#".repeat(level)} ${inlineNodesToMarkdown(Array.from(node.childNodes))}`;
  }

  if (tagName === "p") {
    return inlineNodesToMarkdown(Array.from(node.childNodes));
  }

  if (tagName === "ul" || tagName === "ol") {
    return listToMarkdown(node);
  }

  if (tagName === "pre") {
    const code = trimBlankLines(node.textContent ?? "");
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }

  if (tagName === "blockquote") {
    const content = childrenToMarkdown(node)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");

    return content;
  }

  if (tagName === "table") {
    return tableToMarkdown(node);
  }

  if (tagName === "hr") {
    return "---";
  }

  return childrenToMarkdown(node) || inlineNodesToMarkdown(Array.from(node.childNodes));
}

function childrenToMarkdown(element: Element) {
  return trimBlankLines(
    Array.from(element.childNodes)
      .map((child) => blockNodeToMarkdown(child))
      .filter(Boolean)
      .join("\n\n")
  );
}

/**
 * Convert a rendered docs article (the `[data-docs-content]` element) into a
 * markdown document with a trailing `Source:` attribution line.
 *
 * @param article - The article element containing the docs page markup.
 * @param sourceUrl - Absolute URL of the canonical HTML page.
 * @returns The markdown document, or an empty string when the article has no
 *   convertible content.
 */
export function buildPageMarkdown(article: Element, sourceUrl: string): string {
  const body = childrenToMarkdown(article);

  if (!body) {
    return "";
  }

  return `${body}\n\n---\n\nSource: ${sourceUrl}`;
}
