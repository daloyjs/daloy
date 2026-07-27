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
 *
 * Two structural rules keep the output readable:
 *
 * - **Inline runs stay together.** Consecutive inline children (text, `code`,
 *   `a`, `strong`, `span`, …) are merged into one paragraph instead of each
 *   becoming its own block, so a sentence with inline code inside a
 *   `blockquote` or a `div` no longer shatters into orphan fragments.
 * - **Diagrams convert structurally.** The diagram components
 *   ([diagram.tsx](../components/diagram.tsx)) render CSS-positioned boxes
 *   whose visual line breaks are invisible to a DOM walker, so they annotate
 *   their parts with `data-diagram-*` attributes and are converted here into a
 *   labelled list. Without this the labels flatten into run-together text.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Tags that render inline. Anything else is treated as a block boundary when
 * walking a container's children.
 */
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

/**
 * Leading characters that would turn a paragraph into a heading, blockquote,
 * table row, or list item. Only the first character of a paragraph is escaped —
 * escaping every markdown-ish character inside prose is what produced the
 * `secureDefaults\: false\.` style artifacts.
 */
const BLOCK_START_PATTERN = /^(?:#{1,6}(?=\s)|>|\||[-+*](?=\s)|\d{1,9}[.)](?=\s))/;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

/**
 * Returns the lowercase tag name for element nodes, or `null` for anything
 * else (text, comments) and for SVG subtrees, which the converter skips the
 * same way the original `instanceof HTMLElement` checks did in the browser.
 */
function convertibleTagName(node: Node): string | null {
  const tagName = isElement(node) ? node.tagName.toLowerCase() : null;
  return tagName === "svg" ? null : tagName;
}

/**
 * Nodes that contribute nothing to the document: comments, and elements hidden
 * from assistive tech (decorative connector arrows, tone dots, rules), which
 * are exactly the elements that carry no meaning in plain text either.
 */
function isSkippedNode(node: Node): boolean {
  if (node.nodeType === TEXT_NODE) {
    return false;
  }

  if (!isElement(node)) {
    return true;
  }

  return node.getAttribute("aria-hidden") === "true";
}

/**
 * True when a node flows inline and can be merged into the surrounding
 * paragraph. SVG counts as inline because it converts to nothing and must not
 * split a sentence in half.
 */
function isInlineNode(node: Node): boolean {
  if (node.nodeType === TEXT_NODE) {
    return true;
  }

  if (!isElement(node)) {
    return true;
  }

  const tagName = node.tagName.toLowerCase();
  return tagName === "svg" || INLINE_TAGS.has(tagName);
}

function escapeBlockStart(text: string) {
  return text.replace(BLOCK_START_PATTERN, "\\$&");
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

/**
 * Convert a run of inline nodes to markdown.
 *
 * Adjacent inline *elements* with no whitespace between them (flex or grid
 * children, which the browser lays out with a visual gap) are separated by a
 * space, so `<span>✓</span><span>Rate limit…</span>` becomes `✓ Rate limit…`
 * instead of `✓Rate limit…`.
 */
function inlineNodesToMarkdown(nodes: Node[]) {
  let markdown = "";
  let previousWasElement = false;

  nodes.forEach((node) => {
    if (isSkippedNode(node)) {
      return;
    }

    const segment = inlineNodeToMarkdown(node);

    if (!segment) {
      return;
    }

    const elementNode = isElement(node);

    if (
      markdown &&
      elementNode &&
      previousWasElement &&
      !/\s$/.test(markdown) &&
      !/^\s/.test(segment)
    ) {
      markdown += " ";
    }

    markdown += segment;
    previousWasElement = elementNode;
  });

  return normalizeInlineMarkdown(markdown);
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
    const text =
      inlineNodesToMarkdown(Array.from(node.childNodes)).trim() || (node.textContent ?? "").trim();
    const href = node.getAttribute("href") ?? "";

    return href ? `[${text}](${href})` : text;
  }

  if (tagName === "strong" || tagName === "b") {
    return `**${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}**`;
  }

  if (tagName === "em" || tagName === "i") {
    return `*${inlineNodesToMarkdown(Array.from(node.childNodes)).trim()}*`;
  }

  return inlineNodesToMarkdown(Array.from(node.childNodes));
}

function normalizeInlineMarkdown(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/**
 * Convert an element's inline content to markdown, or return an empty string
 * when the element is absent. Used for the annotated parts of a diagram.
 */
function inlinePartToMarkdown(element: Element | null): string {
  return element ? inlineNodesToMarkdown(Array.from(element.childNodes)) : "";
}

function codeBlockToMarkdown(element: Element) {
  const language = element.getAttribute("data-language") ?? "text";
  const pre = element.querySelector("pre");
  const code = trimBlankLines(pre?.textContent ?? "");
  const fence = language === "text" ? "```" : `\`\`\`${language}`;

  return code ? `${fence}\n${code}\n\`\`\`` : "";
}

/**
 * Convert a single annotated diagram node (a step, layer, branch, or sequence
 * message) into one list-item line: a bold headline, optional qualifiers in
 * parentheses, then the secondary parts separated by ` - `.
 */
function diagramNodeToMarkdown(node: Element): string {
  const from = inlinePartToMarkdown(node.querySelector("[data-diagram-from]"));
  const to = inlinePartToMarkdown(node.querySelector("[data-diagram-to]"));
  const label = inlinePartToMarkdown(node.querySelector("[data-diagram-label]"));
  const headline = from && to ? `${from} -> ${to}` : label;

  if (!headline) {
    return "";
  }

  const qualifiers = [
    node.getAttribute("data-diagram-role") ?? "",
    inlinePartToMarkdown(node.querySelector("[data-diagram-eyebrow]")),
  ].filter(Boolean);

  const parts = [
    qualifiers.length ? `**${headline}** (${qualifiers.join(", ")})` : `**${headline}**`,
  ];

  if (from && to && label) {
    parts.push(label);
  }

  const detail = inlinePartToMarkdown(node.querySelector("[data-diagram-detail]"));

  if (detail) {
    parts.push(detail);
  }

  const items = Array.from(node.querySelectorAll("[data-diagram-item]"))
    .map((item) => inlinePartToMarkdown(item as unknown as Element))
    .filter(Boolean);

  if (items.length > 0) {
    parts.push(`[${items.join(", ")}]`);
  }

  return parts.join(" - ");
}

/**
 * Convert a diagram `<figure>` into a titled list.
 *
 * The diagram variants position their boxes with flexbox and grid, so the
 * visual reading order and line breaks exist only in CSS. Converting the raw
 * DOM would run every label together (`01ingressCross-origin POST…`), so the
 * `data-diagram-*` annotations are read instead and rendered as an ordered list
 * when the diagram numbers its steps, otherwise as a bullet list.
 */
function diagramToMarkdown(figure: Element): string {
  const blocks: string[] = [];
  const title = inlinePartToMarkdown(figure.querySelector("[data-diagram-title]"));

  if (title) {
    blocks.push(`**Diagram: ${title}**`);
  }

  const participants = Array.from(
    figure.querySelectorAll("[data-diagram-participants] [data-diagram-item]")
  )
    .map((participant) => inlinePartToMarkdown(participant as unknown as Element))
    .filter(Boolean);

  if (participants.length > 0) {
    blocks.push(`Participants: ${participants.join(", ")}`);
  }

  const nodes = Array.from(figure.querySelectorAll("[data-diagram-node]")) as unknown as Element[];
  const numbered = nodes.some((node) => node.querySelector("[data-diagram-index]"));
  const items = nodes.map((node) => diagramNodeToMarkdown(node)).filter(Boolean);

  if (items.length > 0) {
    blocks.push(
      items.map((item, index) => (numbered ? `${index + 1}. ${item}` : `- ${item}`)).join("\n")
    );
  }

  const caption = inlinePartToMarkdown(figure.querySelector("[data-diagram-caption]"));

  if (caption) {
    blocks.push(escapeBlockStart(caption));
  }

  return blocks.join("\n\n");
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
  const nestedLists: string[] = [];
  const contentNodes: Node[] = [];

  Array.from(item.childNodes).forEach((child) => {
    const tagName = convertibleTagName(child);

    if (tagName === "ul" || tagName === "ol") {
      nestedLists.push(listToMarkdown(child as Element, depth + 1));
      return;
    }

    contentNodes.push(child);
  });

  const indent = "  ".repeat(depth);
  const [first = "", ...rest] = nodeBlocks(contentNodes);
  const lines = [`${indent}${marker} ${first}`.trimEnd()];

  // Extra blocks in the same item (a paragraph followed by a code fence, say)
  // are indented under the marker so they stay part of the item.
  rest.forEach((block) => {
    lines.push("");
    lines.push(
      block
        .split("\n")
        .map((line) => (line ? `${indent}  ${line}` : ""))
        .join("\n")
    );
  });

  nestedLists.filter(Boolean).forEach((block) => {
    lines.push(block);
  });

  return lines.join("\n");
}

function blockElementToMarkdown(element: Element): string {
  const tagName = convertibleTagName(element);

  if (tagName === null) {
    return "";
  }

  if (element.classList.contains("code-editor")) {
    return codeBlockToMarkdown(element);
  }

  if (element.hasAttribute("data-diagram")) {
    return diagramToMarkdown(element);
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName[1]);
    return `${"#".repeat(level)} ${inlineNodesToMarkdown(Array.from(element.childNodes))}`;
  }

  if (tagName === "p") {
    return escapeBlockStart(inlineNodesToMarkdown(Array.from(element.childNodes)));
  }

  if (tagName === "ul" || tagName === "ol") {
    return listToMarkdown(element);
  }

  if (tagName === "pre") {
    const code = trimBlankLines(element.textContent ?? "");
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }

  if (tagName === "blockquote") {
    return childrenToMarkdown(element)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }

  if (tagName === "table") {
    return tableToMarkdown(element);
  }

  if (tagName === "hr") {
    return "---";
  }

  return childrenToMarkdown(element);
}

/**
 * Split a node list into markdown blocks, merging each run of consecutive
 * inline nodes into a single paragraph.
 */
function nodeBlocks(nodes: Node[]): string[] {
  const blocks: string[] = [];
  let inlineRun: Node[] = [];

  const flushInlineRun = () => {
    if (inlineRun.length === 0) {
      return;
    }

    const paragraph = escapeBlockStart(inlineNodesToMarkdown(inlineRun));
    inlineRun = [];

    if (paragraph) {
      blocks.push(paragraph);
    }
  };

  nodes.forEach((node) => {
    if (isSkippedNode(node)) {
      return;
    }

    if (isInlineNode(node)) {
      inlineRun.push(node);
      return;
    }

    flushInlineRun();

    const block = blockElementToMarkdown(node as Element);

    if (block) {
      blocks.push(block);
    }
  });

  flushInlineRun();

  return blocks;
}

function childrenToMarkdown(element: Element) {
  return trimBlankLines(nodeBlocks(Array.from(element.childNodes)).join("\n\n"));
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
