/**
 * One-shot migration helper: convert a hand-written docs `page.tsx` into an
 * MDX page under `content/docs`, keeping the rendered output the same.
 *
 * Usage (from `website/`):
 *
 *   node --import tsx scripts/tsx-to-mdx.ts app/docs/tutorials/bookstore/page.tsx [...more]
 *   node --import tsx scripts/tsx-to-mdx.ts --check app/docs/...   # print, don't write
 *
 * What it converts to markdown: headings (keeping hand-written ids via a
 * `[#id]` marker when they differ from the slug), paragraphs, lists, tables
 * with inline-only cells, blockquotes, `<CodeBlock>` (to fenced code), and the
 * inline elements `code`, `strong`, `em`, `a` and `Link`. Anything else
 * (diagrams, callouts, styled `<div>`s) is copied verbatim as JSX, which MDX
 * renders unchanged. Top-level constants referenced by verbatim JSX are kept
 * as `export const` statements.
 *
 * It refuses pages that import components the MDX renderer does not provide
 * (see `mdxComponents` in `lib/mdx/render.tsx`), and it validates every
 * output with the MDX compiler before writing. Verify the result by diffing
 * the page's `.md` export before and after (`/docs/<route>.md`).
 */
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "@babel/parser";
import { compile } from "@mdx-js/mdx";
import { parseHTML } from "linkedom";
import GithubSlugger from "github-slugger";
import remarkGfm from "remark-gfm";
import { stringify as stringifyYaml } from "yaml";

type Node = { type: string; start?: number | null; end?: number | null; [key: string]: any };

/** Components the MDX renderer provides globally, plus the imports that are safe to drop. */
const PROVIDED = new Set([
  "AuthRole", "AutoTypeTable", "BranchDiagram", "CoreVersion", "Callout", "Card", "Cards", "CodeBlock", "Diagram", "File", "Files",
  "FlowDiagram", "Folder", "IdpBoundary", "LayerStack", "Link", "PackageInstall", "SequenceDiagram", "SiteApiReference",
  "Step", "Steps", "TypeTable", "UseCaseGuide",
]);
const DROPPABLE_IMPORTS = new Set(["buildMetadata", "Route", "Metadata"]);

const ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–",
  rarr: "→", larr: "←", hellip: "…", middot: "·", times: "×", copy: "©",
};

const ENTITY_DECODER = parseHTML("<!doctype html><html><body><p></p></body></html>").document.querySelector("p")!;

/**
 * Decode HTML character references (`&rsquo;`, `&#x2192;`, …) the way JSX
 * does. Uses a real HTML parser so every named entity works, not a short list.
 */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    if (ENTITIES[name]) return ENTITIES[name]!;
    ENTITY_DECODER.innerHTML = match;
    return ENTITY_DECODER.textContent ?? match;
  });
}

/** JSX whitespace semantics: trim each line's edges, drop blank lines, join with a space. */
function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  lines.forEach((line, index) => {
    let value = line.replace(/\t/g, " ");
    if (index > 0) value = value.replace(/^\s+/, "");
    if (index < lines.length - 1) value = value.replace(/\s+$/, "");
    if (value) kept.push(value);
  });
  return decodeEntities(kept.join(" "));
}

/** Backslash-escape characters that markdown or MDX would otherwise interpret. */
function escapeMarkdown(text: string): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(AUTOLINK_LITERAL)) {
    out += escapeMarkdownChars(text.slice(cursor, match.index)) + `{${JSON.stringify(match[0])}}`;
    cursor = match.index! + match[0].length;
  }
  return out + escapeMarkdownChars(text.slice(cursor));
}

function escapeMarkdownChars(text: string): string {
  return text
    .replace(/[\\`*_[\]<>{}~]/g, (c) => `\\${c}`)
    .replace(/&(?=[a-z#][a-z0-9]*;)/gi, "\\&");
}

/**
 * GFM "autolink literal" triggers: bare `http(s)://…`, `www.…`, and emails.
 * Backslash escapes do not stop GFM from linking these, so they are emitted
 * as JSX string expressions instead, which render the same characters and are
 * never auto-linked.
 */
const AUTOLINK_LITERAL =
  /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<]*[^\s<?!.,:*_~)"']|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Escape block-level markers that only matter at the start of a line. */
function escapeBlockStart(line: string): string {
  return line
    .replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s|={3,}|-{3,})/, (m) => `\\${m}`)
    .replace(/^(\s*)\\(\d)/, "$1$2\\");
}

class Unconvertible extends Error {}

export class Converter {
  private readonly consts = new Map<string, { value: string | null; source: string }>();
  private readonly usedConsts = new Set<string>();
  private readonly slugger = new GithubSlugger();
  /** Blog mode: the post's `POST` object (string fields), substituted inline. */
  private post: Record<string, string> | null = null;
  /**
   * Blog mode: top-level helpers (functions, non-string consts they use) moved
   * into a TSX module, `components/blog/<slug>.tsx`. PascalCase ones are
   * passed to MDX as components; the rest are reached as `props.scope.<name>`.
   */
  private readonly moved = new Set<string>();
  /** Source text of the moved declarations, in file order. */
  readonly movedSources: string[] = [];
  /** Import statements of the original page, for the moved module. */
  readonly importSources: string[] = [];

  /** `POST.<field>` → its string value in blog mode, otherwise null. */
  private postValue(node: Node | null | undefined): string | null {
    if (!this.post || !node || node.type !== "MemberExpression" || node.computed) return null;
    if (node.object.type !== "Identifier" || node.object.name !== "POST") return null;
    return this.post[node.property.name] ?? null;
  }

  constructor(private readonly source: string, private readonly file: string) {}

  private text(node: Node): string {
    return this.source.slice(node.start ?? 0, node.end ?? 0);
  }

  private stringValue(node: Node | null | undefined): string | null {
    if (!node) return null;
    if (node.type === "StringLiteral") return node.value;
    if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
    if (node.type === "JSXExpressionContainer") return this.stringValue(node.expression);
    if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return this.stringValue(node.expression);
    if (this.postValue(node) !== null) return this.postValue(node);
    if (node.type === "Identifier" && this.consts.get(node.name)?.value != null) return this.consts.get(node.name)!.value;
    return null;
  }

  private attrs(element: Node): Map<string, Node | null> {
    const out = new Map<string, Node | null>();
    for (const attr of element.openingElement.attributes) {
      if (attr.type !== "JSXAttribute") throw new Unconvertible("spread attributes");
      out.set(attr.name.name, attr.value);
    }
    return out;
  }

  private name(element: Node): string {
    const n = element.openingElement.name;
    return n.type === "JSXIdentifier" ? n.name : this.text(n);
  }

  /** Record identifiers used inside verbatim JSX so their declarations are exported. */
  private collectIdentifiers(node: Node): void {
    const visit = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(visit);
      if (value.type === "Identifier" && this.consts.has(value.name) && !this.moved.has(value.name)) this.usedConsts.add(value.name);
      if (value.type === "JSXIdentifier" && /^[A-Z]/.test(value.name) && !PROVIDED.has(value.name) && !this.moved.has(value.name)) {
        throw new Unconvertible(`component <${value.name}> is not provided to MDX`);
      }
      for (const key of Object.keys(value)) {
        if (key !== "loc" && key !== "start" && key !== "end" && key !== "extra") visit(value[key]);
      }
    };
    visit(node);
  }

  /**
   * Source text of `node` with TypeScript-only syntax removed (`as T`,
   * `satisfies T`, `!`, type annotations and type arguments), since MDX
   * expressions and ESM are parsed as plain JavaScript.
   */
  private jsText(node: Node): string {
    const cuts: Array<[number, number, string?]> = [];
    const visit = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(visit);
      if (value.type === "TSAsExpression" || value.type === "TSSatisfiesExpression") {
        cuts.push([value.expression.end, value.end]);
      } else if (value.type === "TSNonNullExpression") {
        cuts.push([value.end - 1, value.end]);
      } else if (value.type === "TSTypeAnnotation" || value.type === "TSTypeParameterInstantiation") {
        cuts.push([value.start, value.end]);
        return;
      } else if (this.postValue(value) !== null) {
        // Blog mode: `POST.title` and friends become their literal values.
        cuts.push([value.start, value.end, JSON.stringify(this.postValue(value))]);
        return;
      } else if (value.type === "Identifier" && this.moved.has(value.name) && !/^[A-Z]/.test(value.name)) {
        // Blog mode: a moved helper function/const lives in the post's TSX
        // module and is passed to MDX as props.scope.
        cuts.push([value.start, value.end, `props.scope.${value.name}`]);
        return;
      } else if (this.post && value.type === "CallExpression" && value.callee.type === "Identifier" && value.callee.name === "cn") {
        // Blog mode: MDX cannot import cn(); the renderer passes it as a prop.
        cuts.push([value.callee.start, value.callee.end, "props.cn"]);
      }
      for (const key of Object.keys(value)) {
        if (key !== "loc" && key !== "extra") visit(value[key]);
      }
    };
    visit(node);
    let out = "";
    let cursor = node.start ?? 0;
    for (const [from, to, replacement = ""] of cuts.sort((a, b) => a[0] - b[0])) {
      if (from < cursor) continue;
      out += this.source.slice(cursor, from) + replacement;
      cursor = to;
    }
    return out + this.source.slice(cursor, node.end ?? 0);
  }

  /** Tags that flow inline inside raw JSX (their text must stay on one line). */
  private static readonly INLINE_TAGS = new Set([
    "code", "strong", "b", "em", "i", "a", "Link", "br", "span", "kbd", "abbr", "sup", "sub", "small", "mark", "s", "u", "CoreVersion",
  ]);

  private isInlineContent(node: Node): boolean {
    if (node.type === "JSXText") return node.value.trim() !== "";
    if (node.type === "JSXExpressionContainer") return node.expression.type !== "JSXEmptyExpression";
    return node.type === "JSXElement" && Converter.INLINE_TAGS.has(this.name(node));
  }

  /** Children rendered inline, on one line, with JSX whitespace semantics. */
  private renderInlineChildren(children: Node[]): string {
    return children
      .map((child) => {
        if (child.type === "JSXText") return escapeMarkdown(jsxTextValue(child.extra?.raw ?? child.value));
        if (child.type === "JSXExpressionContainer") {
          if (child.expression.type === "JSXEmptyExpression") return "";
          // Same reason as attrText(): a multi-line static template child
          // (e.g. <code>{`...`}</code> in a <pre>) would be re-indented by MDX.
          const expr = child.expression;
          if (expr.type === "TemplateLiteral" && expr.expressions.length === 0 && expr.quasis[0].value.cooked.includes("\n")) {
            return `{${JSON.stringify(expr.quasis[0].value.cooked)}}`;
          }
          return this.jsText(child);
        }
        if (child.type === "JSXElement" || child.type === "JSXFragment") return this.renderJsxInline(child);
        return this.jsText(child);
      })
      .join("");
  }

  /**
   * Source for one JSX attribute. A static template literal value (typically a
   * multi-line `code={`...`}`) is re-emitted as a single-line string literal
   * with the identical value: inside a markdown text run MDX parses line by
   * line, so a code line that looks like markdown would otherwise cut the
   * expression short.
   */
  private attrText(attr: Node): string {
    const value = attr.value;
    if (
      attr.type === "JSXAttribute" &&
      value?.type === "JSXExpressionContainer" &&
      value.expression.type === "TemplateLiteral" &&
      value.expression.expressions.length === 0 &&
      value.expression.quasis[0].value.cooked.includes("\n")
    ) {
      return `${this.text(attr.name)}={${JSON.stringify(value.expression.quasis[0].value.cooked)}}`;
    }
    return this.jsText(attr);
  }

  /**
   * Opening/closing tags rebuilt from the AST with the attributes on one line.
   * A tag that spans lines is unsafe inside markdown text: a continuation line
   * starting with `>` (the end of a multi-line tag) reads as a blockquote.
   * Each attribute keeps its own source text, so multi-line expression values
   * (diagram step arrays, etc.) are preserved as written.
   */
  private tags(node: Node): { open: string; close: string } {
    if (node.type === "JSXFragment") return { open: "<>", close: "</>" };
    const opening = node.openingElement;
    const name = this.text(opening.name);
    const attributes = opening.attributes.map((attr: Node) => ` ${this.attrText(attr)}`).join("");
    return {
      open: `<${name}${attributes}${opening.selfClosing ? " />" : ">"}`,
      close: node.closingElement ? `</${name}>` : "",
    };
  }

  private renderJsxInline(node: Node): string {
    const { open, close } = this.tags(node);
    if (node.type === "JSXElement" && node.openingElement.selfClosing) return open;
    return `${open}${this.renderInlineChildren(node.children)}${close}`;
  }

  /**
   * Render raw JSX so MDX produces the same DOM as the original TSX. MDX parses
   * text inside JSX as markdown, where a newline is a space and a text line is
   * wrapped in <p>. So an element whose children include any text or inline
   * element is written on a single line (JSX whitespace rules applied), and
   * only purely structural children go on their own, indented lines.
   */
  private renderJsx(node: Node, indent: string): string {
    if (node.type !== "JSXElement" && node.type !== "JSXFragment") return this.jsText(node);
    const { open, close } = this.tags(node);
    if (node.type === "JSXElement" && node.openingElement.selfClosing) return open;
    const meaningful = node.children.filter((child: Node) => !(child.type === "JSXText" && child.value.trim() === ""));
    if (meaningful.length === 0) return `${open}${close}`;
    if (meaningful.some((child: Node) => this.isInlineContent(child))) {
      return `${open}${this.renderInlineChildren(node.children)}${close}`;
    }
    // Children go on their own lines at column 0. Indenting them looks nicer
    // but MDX strips that indent from every line of the child, including the
    // lines of a multi-line code template literal.
    const lines = meaningful.map((child: Node) => this.renderJsx(child, indent));
    return [open, ...lines, close].join("\n");
  }

  private verbatim(node: Node, inline = false): string {
    this.collectIdentifiers(node);
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      return inline ? this.renderJsxInline(node) : this.renderJsx(node, "");
    }
    return this.jsText(node);
  }

  private isBlank(node: Node): boolean {
    return node.type === "JSXText" && node.value.trim() === "";
  }

  // ---------- inline ----------

  inline(children: Node[]): string {
    let out = "";
    for (const child of children) out += this.inlineNode(child);
    // Collapse only the whitespace JSX collapses; \s would also eat U+00A0.
    return out.replace(/[ \t\r\n]+/g, " ");
  }

  private plainText(children: Node[]): string {
    return children
      .map((child) => {
        if (child.type === "JSXText") return jsxTextValue(child.extra?.raw ?? child.value);
        const value = this.stringValue(child);
        if (value !== null) return value;
        if (child.type === "JSXElement") return this.plainText(child.children);
        throw new Unconvertible(`expression inside inline code: ${this.text(child)}`);
      })
      .join("");
  }

  private wrap(marker: string, inner: string): string {
    const trimmed = inner.trim();
    if (!trimmed) return inner;
    const lead = inner.startsWith(" ") ? " " : "";
    const trail = inner.endsWith(" ") ? " " : "";
    return `${lead}${marker}${trimmed}${marker}${trail}`;
  }

  private inlineNode(node: Node): string {
    if (node.type === "JSXText") return escapeMarkdown(jsxTextValue(node.extra?.raw ?? node.value));
    if (node.type === "JSXExpressionContainer") {
      if (node.expression.type === "JSXEmptyExpression") return "";
      const value = this.stringValue(node.expression);
      if (value !== null) return escapeMarkdown(value);
      return this.verbatim(node, true);
    }
    if (node.type !== "JSXElement") return this.verbatim(node, true);

    const name = this.name(node);
    const attrs = this.attrs(node);
    switch (name) {
      case "code": {
        if (attrs.size > 0) return this.verbatim(node, true);
        const code = this.plainText(node.children);
        const fence = code.includes("`") ? "``" : "`";
        const pad = fence.length > 1 || code.startsWith("`") || code.endsWith("`") ? " " : "";
        return `${fence}${pad}${code}${pad}${fence}`;
      }
      case "strong":
      case "b":
        return attrs.size > 0 ? this.verbatim(node, true) : this.wrap("**", this.inline(node.children));
      case "em":
      case "i":
        return attrs.size > 0 ? this.verbatim(node, true) : this.wrap("*", this.inline(node.children));
      case "a":
      case "Link": {
        const href = this.stringValue(attrs.get("href"));
        const allowed = [...attrs.keys()].every((key) => ["href", "target", "rel"].includes(key));
        if (!href || !allowed) return this.verbatim(node, true);
        const external = /^https?:\/\//.test(href);
        // Internal <a> and target=_blank on internal links would change behavior; keep those verbatim.
        if (!external && name === "a" && attrs.has("target")) return this.verbatim(node, true);
        const label = this.inline(node.children).trim();
        return `[${label}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
      }
      case "br":
        return "<br />";
      default:
        return this.verbatim(node, true);
    }
  }

  // ---------- blocks ----------

  private isInlineElement(node: Node): boolean {
    if (node.type === "JSXText" || node.type === "JSXExpressionContainer") return true;
    if (node.type !== "JSXElement") return false;
    return ["code", "strong", "b", "em", "i", "a", "Link", "br", "span", "kbd", "abbr", "sup", "sub", "CoreVersion"].includes(this.name(node));
  }

  blocks(children: Node[], indent = ""): string[] {
    const out: string[] = [];
    let run: Node[] = [];
    const flush = () => {
      const text = this.inline(run).trim();
      if (text) out.push(escapeBlockStart(text));
      run = [];
    };
    for (const child of children) {
      if (this.isInlineElement(child)) {
        run.push(child);
        continue;
      }
      flush();
      if (this.isBlank(child)) continue;
      out.push(this.block(child, indent));
    }
    flush();
    return out.filter((block) => block !== "");
  }

  private codeFence(element: Node): string {
    const attrs = this.attrs(element);
    const codeNode = attrs.get("code");
    const code = this.stringValue(codeNode);
    if (code === null) throw new Unconvertible(`CodeBlock code is not a static string: ${this.text(element).slice(0, 60)}`);
    const known = ["code", "language", "title", "highlight", "lineNumbers"];
    if ([...attrs.keys()].some((key) => !known.includes(key))) return this.verbatim(element);
    const language = this.stringValue(attrs.get("language")) ?? "ts";
    const meta: string[] = [];
    const title = this.stringValue(attrs.get("title"));
    if (title) meta.push(`title="${title}"`);
    const highlight = this.stringValue(attrs.get("highlight"));
    if (highlight) meta.push(`{${highlight}}`);
    if (attrs.has("lineNumbers")) meta.push("lineNumbers");
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = "`".repeat(longest + 1);
    return [`${fence}${[language, ...meta].join(" ")}`, code.replace(/\n$/, ""), fence].join("\n");
  }

  private list(element: Node, ordered: boolean, indent: string): string {
    const items = element.children.filter((child: Node) => !this.isBlank(child));
    return items
      .map((item: Node, index: number) => {
        if (item.type !== "JSXElement" || this.name(item) !== "li" || this.attrs(item).size > 0) {
          throw new Unconvertible("list child is not a plain <li>");
        }
        // Markdown would make this a "loose" item and wrap the text in <p>;
        // keep the whole list as JSX instead (nested lists stay tight, so
        // they are fine).
        const blockKids = item.children.filter(
          (c: Node) => c.type === "JSXElement" && !this.isInlineContent(c) && !["ul", "ol"].includes(this.name(c)),
        );
        const hasBareInline = item.children.some((c: Node) => c.type !== "JSXElement" ? this.isInlineContent(c) : Converter.INLINE_TAGS.has(this.name(c)));
        if (blockKids.length > 0 && hasBareInline) throw new Unconvertible("list item mixes inline text with block content");
        const marker = ordered ? `${index + 1}.` : "-";
        const pad = " ".repeat(marker.length + 1);
        const blocks = this.blocks(item.children, indent + pad);
        const [first = "", ...rest] = blocks;
        const lines = [`${marker} ${first.split("\n").join(`\n${pad}`)}`];
        for (const block of rest) {
          const tight = /^([-*]|\d+\.) /.test(block);
          lines.push((tight ? "" : "\n") + block.split("\n").map((line) => (line ? pad + line : line)).join("\n"));
        }
        return lines.join("\n");
      })
      .join("\n");
  }

  private table(element: Node): string {
    const rows: string[][] = [];
    let headerCount = 0;
    const visitRow = (row: Node, header: boolean) => {
      if (this.attrs(row).size > 0) throw new Unconvertible("table row with attributes (e.g. an anchor id)");
      const cells = row.children.filter((c: Node) => c.type === "JSXElement");
      rows.push(
        cells.map((cell: Node) => {
          if (this.attrs(cell).size > 0) throw new Unconvertible("table cell with attributes");
          if (!cell.children.every((c: Node) => this.isInlineElement(c) || this.isBlank(c))) {
            throw new Unconvertible("table cell with block content");
          }
          return this.inline(cell.children).trim().replace(/\|/g, "\\|");
        }),
      );
      if (header) headerCount += 1;
    };
    for (const section of element.children.filter((c: Node) => c.type === "JSXElement")) {
      const name = this.name(section);
      if (this.attrs(section).size > 0) throw new Unconvertible(`<${name}> with attributes`);
      if (name === "thead" || name === "tbody") {
        for (const row of section.children.filter((c: Node) => c.type === "JSXElement")) visitRow(row, name === "thead");
      } else if (name === "tr") {
        visitRow(section, false);
      } else {
        throw new Unconvertible(`unexpected <${name}> in table`);
      }
    }
    if (headerCount !== 1 || rows.length < 1) throw new Unconvertible("table without exactly one header row");
    const width = rows[0]!.length;
    if (rows.some((row) => row.length !== width)) throw new Unconvertible("ragged table");
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [line(rows[0]!), line(rows[0]!.map(() => "---")), ...rows.slice(1).map(line)].join("\n");
  }

  private block(node: Node, indent: string): string {
    if (node.type !== "JSXElement") return this.verbatim(node);
    const name = this.name(node);
    const attrs = this.attrs(node);

    if (/^h[1-4]$/.test(name)) {
      const onlyId = [...attrs.keys()].every((key) => key === "id");
      if (!onlyId) return this.verbatim(node);
      const text = this.inline(node.children).trim();
      const id = this.stringValue(attrs.get("id"));
      const level = Number(name[1]);
      if (level === 1) return `# ${text}`;
      const plain = this.plainTextLoose(node.children);
      // Mirror remark-daloy exactly: it slugs the text when there is no
      // marker, and reserves the marker id otherwise. Peek first so a heading
      // that gets a marker does not also consume a numbered slug.
      const peek = new GithubSlugger();
      (peek as unknown as { occurrences: Record<string, number> }).occurrences = {
        ...(this.slugger as unknown as { occurrences: Record<string, number> }).occurrences,
      };
      const expected = peek.slug(plain);
      const needsMarker = Boolean(id) && id !== expected;
      this.slugger.slug(needsMarker ? id! : plain);
      const marker = needsMarker ? ` [#${id}]` : "";
      return `${"#".repeat(level)} ${text}${marker}`;
    }

    try {
      switch (name) {
        case "p":
          if (attrs.size > 0) return this.verbatim(node);
          if (!node.children.every((c: Node) => this.isInlineElement(c))) return this.verbatim(node);
          return escapeBlockStart(this.inline(node.children).trim());
        case "ul":
        case "ol":
          if (attrs.size > 0) return this.verbatim(node);
          return this.list(node, name === "ol", indent);
        case "CodeBlock":
          return this.codeFence(node);
        case "table":
          if (attrs.size > 0) return this.verbatim(node);
          return this.table(node);
        case "blockquote": {
          if (attrs.size > 0) return this.verbatim(node);
          // A markdown `>` quote always wraps its text in <p>. When the
          // original blockquote holds bare inline content, keep it as JSX so
          // the DOM (and the prose styling) stays identical.
          if (node.children.every((c: Node) => this.isBlank(c) || this.isInlineContent(c))) return this.verbatim(node);
          return this.blocks(node.children)
            .join("\n\n")
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n");
        }
        default:
          return this.verbatim(node);
      }
    } catch (error) {
      if (error instanceof Unconvertible && !/not provided|static string/.test(error.message)) return this.verbatim(node);
      throw error;
    }
  }

  /** Heading text as the renderer's slugger sees it (no markdown markers). */
  private plainTextLoose(children: Node[]): string {
    return children
      .map((child) => {
        if (child.type === "JSXText") return jsxTextValue(child.extra?.raw ?? child.value);
        if (child.type === "JSXExpressionContainer") return this.stringValue(child.expression) ?? "";
        if (child.type === "JSXElement") return this.plainTextLoose(child.children);
        return "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---------- blog post ----------

  /**
   * Convert a blog `page.tsx` (POST constant, badge header, prose body) into
   * frontmatter plus an MDX body. The header, JSON-LD and byline are rendered
   * by `BlogPostLayout` from the frontmatter, so only the prose body is kept.
   */
  convertBlog(): { mdx: string; slug: string } {
    const ast = parse(this.source, { sourceType: "module", plugins: ["jsx", "typescript"] }) as unknown as Node;
    let metadata: Node | null = null;
    const helperDecls = new Map<string, Node>();
    const typeDecls: string[] = [];
    const constDecls = new Map<string, Node>();
    let body: Node | null = null;
    for (const statement of ast.program.body as Node[]) {
      if (statement.type === "ImportDeclaration") {
        // Imports go to the helper module (if any); MDX itself imports nothing.
        this.importSources.push(this.text(statement));
        continue;
      }
      const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      if (declaration?.type === "TSTypeAliasDeclaration" || declaration?.type === "TSInterfaceDeclaration") {
        typeDecls.push(this.text(declaration));
        continue;
      }
      if (declaration?.type === "FunctionDeclaration") {
        helperDecls.set(declaration.id.name, declaration);
        continue;
      }
      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          const name = decl.id.name;
          if (name === "POST") {
            this.post = Object.fromEntries(
              decl.init.properties.map((prop: Node) => {
                const value = this.stringValue(prop.value);
                if (value === null) throw new Unconvertible(`POST.${prop.key.name} is not a static string`);
                return [prop.key.name, value];
              }),
            );
          } else if (name === "metadata") metadata = decl.init;
          else if (name === "dateFormatter" || name === "jsonLd") continue;
          else {
            this.consts.set(name, { value: this.stringValue(decl.init), source: this.jsText(declaration) });
            constDecls.set(name, declaration);
          }
        }
        continue;
      }
      if (statement.type === "ExportDefaultDeclaration") {
        const fn = statement.declaration;
        if ((fn.body?.body ?? []).length > 1) throw new Unconvertible("default export has logic before return");
        const ret = fn.body.body[0].argument;
        body = ret.type === "ParenthesizedExpression" ? ret.expression : ret;
        continue;
      }
      throw new Unconvertible(`unsupported top-level statement: ${statement.type}`);
    }
    if (!this.post) throw new Unconvertible("no POST constant");
    if (!body) throw new Unconvertible("no default export");


    const find = (node: Node, pred: (n: Node) => boolean): Node | null => {
      if (!node || typeof node !== "object") return null;
      if (node.type === "JSXElement" && pred(node)) return node;
      for (const child of node.children ?? []) {
        const hit = find(child, pred);
        if (hit) return hit;
      }
      return null;
    };
    const header = find(body, (n) => this.name(n) === "header");
    const prose = find(body, (n) => /docs-prose/.test(this.text(n.openingElement)));
    if (!header || !prose) throw new Unconvertible("post does not follow the header + docs-prose template");

    // Move helper functions, plus every non-string const they (transitively)
    // reference, into the post's TSX module. String consts stay in MDX
    // (inlined into code fences), but are also copied when a helper needs them.
    const references = (node: Node): Set<string> => {
      const names = new Set<string>();
      const visit = (value: any) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(visit);
        if ((value.type === "Identifier" || value.type === "JSXIdentifier") && typeof value.name === "string") names.add(value.name);
        for (const key of Object.keys(value)) if (key !== "loc" && key !== "extra") visit(value[key]);
      };
      visit(node);
      return names;
    };
    const queue = [...helperDecls.keys()];
    const moveDecl = new Map<string, Node>();
    while (queue.length) {
      const name = queue.shift()!;
      if (moveDecl.has(name)) continue;
      const node = helperDecls.get(name) ?? constDecls.get(name);
      if (!node) continue;
      moveDecl.set(name, node);
      for (const ref of references(node)) if ((helperDecls.has(ref) || constDecls.has(ref)) && !moveDecl.has(ref)) queue.push(ref);
    }
    // Non-string consts used only by the body move too, so MDX never needs
    // JS objects that might reference helpers.
    for (const [name, node] of constDecls) {
      if (this.consts.get(name)?.value === null && !moveDecl.has(name)) {
        const refs = references(prose);
        if (refs.has(name)) moveDecl.set(name, node);
      }
    }
    for (const [name, node] of [...moveDecl].sort((a, b) => (a[1].start ?? 0) - (b[1].start ?? 0))) {
      this.moved.add(name);
      this.movedSources.push(this.text(node));
    }
    if (this.movedSources.length) this.movedSources.unshift(...typeDecls);

    const badges: Array<string | { label: string; variant: string }> = [];
    const collectBadges = (node: Node) => {
      if (node.type !== "JSXElement") return;
      if (this.name(node) === "Badge") {
        const label = this.plainTextLoose(node.children);
        const variant = this.stringValue(this.attrs(node).get("variant")) ?? "default";
        badges.push(variant === "outline" ? label : { label, variant });
        return;
      }
      node.children.forEach(collectBadges);
    };
    collectBadges(header);

    // The closing author card (if any): its links become frontmatter.
    const footer = find(body, (n) => this.name(n) === "footer");
    const footerLinks: Array<{ label: string; href: string }> = [];
    const collectLinks = (node: Node) => {
      if (node.type !== "JSXElement") return;
      if (["Link", "a"].includes(this.name(node))) {
        const href = this.stringValue(this.attrs(node).get("href"));
        if (!href) throw new Unconvertible("footer link without a static href");
        footerLinks.push({ label: this.plainTextLoose(node.children), href });
        return;
      }
      node.children.forEach(collectLinks);
    };
    if (footer) collectLinks(footer);

    const keywordsProp = (metadata?.arguments?.[0]?.properties ?? []).find((prop: Node) => (prop.key.name ?? prop.key.value) === "keywords");
    const keywords = keywordsProp ? keywordsProp.value.elements.map((el: Node) => this.stringValue(el)) : [];

    const { slug, title, description, date, readingTime, author, authorRole, authorBio } = this.post;
    const frontmatter: Record<string, unknown> = { title, description, date, readingTime, author, authorRole };
    if (authorBio) frontmatter.authorBio = authorBio;
    frontmatter.badges = badges;
    frontmatter.keywords = keywords;
    if (footerLinks.length) frontmatter.footerLinks = footerLinks;

    const blocks = this.blocks(prose.children);
    const exports = [...this.usedConsts].map((name) => {
      const declaration = this.consts.get(name)!.source;
      return declaration.startsWith("export ") ? declaration : `export ${declaration}`;
    });
    const mdx = [
      "---",
      stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd(),
      "---",
      "",
      ...(exports.length ? [exports.join("\n\n"), ""] : []),
      blocks.join("\n\n"),
      "",
    ].join("\n");
    return { mdx, slug: slug! };
  }

  // ---------- page ----------

  convert(): { mdx: string; frontmatter: Record<string, unknown>; route: string } {
    const ast = parse(this.source, { sourceType: "module", plugins: ["jsx", "typescript"] }) as unknown as Node;
    let metadata: Node | null = null;
    let body: Node | null = null;

    for (const statement of ast.program.body as Node[]) {
      if (statement.type === "ImportDeclaration") {
        for (const spec of statement.specifiers) {
          const local = spec.local.name;
          if (!PROVIDED.has(local) && !DROPPABLE_IMPORTS.has(local)) {
            throw new Unconvertible(`imports ${local} from "${statement.source.value}", which MDX pages cannot use`);
          }
        }
        continue;
      }
      const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      // Type-only declarations have no runtime meaning in MDX; drop them.
      if (declaration?.type === "TSTypeAliasDeclaration" || declaration?.type === "TSInterfaceDeclaration") continue;
      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (decl.id.name === "metadata") {
            metadata = decl.init;
            continue;
          }
          this.consts.set(decl.id.name, { value: this.stringValue(decl.init), source: this.jsText(declaration) });
        }
        continue;
      }
      if (statement.type === "ExportDefaultDeclaration") {
        const fn = statement.declaration;
        const ret = (fn.body?.body ?? []).find((s: Node) => s.type === "ReturnStatement");
        if (!ret) throw new Unconvertible("default export has no return statement");
        body = ret.argument.type === "ParenthesizedExpression" ? ret.argument.expression : ret.argument;
        if ((fn.body?.body ?? []).length > 1) throw new Unconvertible("default export has logic before return");
        continue;
      }
      throw new Unconvertible(`unsupported top-level statement: ${statement.type}`);
    }

    if (!metadata || metadata.type !== "CallExpression" || metadata.callee.name !== "buildMetadata") {
      throw new Unconvertible("no `export const metadata = buildMetadata({...})`");
    }
    const frontmatter: Record<string, unknown> = {};
    let route = "";
    for (const prop of metadata.arguments[0].properties as Node[]) {
      const key = prop.key.name ?? prop.key.value;
      if (key === "type") continue;
      if (key === "path") {
        route = this.stringValue(prop.value) ?? "";
        continue;
      }
      if (prop.value.type === "ArrayExpression") {
        frontmatter[key] = prop.value.elements.map((el: Node) => this.stringValue(el));
      } else {
        const value = this.stringValue(prop.value);
        if (value === null) throw new Unconvertible(`metadata.${key} is not a static string`);
        frontmatter[key] = value;
      }
    }
    if (!route) throw new Unconvertible("metadata has no path");

    if (!body) throw new Unconvertible("no default export");
    const children = body.type === "JSXFragment" ? body.children : [body];
    const blocks = this.blocks(children);

    const exports = [...this.usedConsts].map((name) => {
      const declaration = this.consts.get(name)!.source;
      return declaration.startsWith("export ") ? declaration : `export ${declaration}`;
    });

    const mdx = [
      "---",
      stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd(),
      "---",
      "",
      ...(exports.length ? [exports.join("\n\n"), ""] : []),
      blocks.join("\n\n"),
      "",
    ].join("\n");

    return { mdx, frontmatter, route };
  }
}

/** Directory of the per-post helper modules (`components/blog/<slug>.tsx`). */
const BLOG_HELPERS_DIR = path.join("components", "blog");

/**
 * Write a post's moved helpers (components, functions, the consts they use)
 * to `components/blog/<slug>.tsx`, verbatim and exported, with the page's
 * imports. Skipped when the post has no helpers. Then refresh the registry.
 */
async function writeBlogHelperModule(slug: string, converter: Converter): Promise<void> {
  const file = path.join(BLOG_HELPERS_DIR, `${slug}.tsx`);
  if (converter.movedSources.length === 0) {
    await rm(file, { force: true });
  } else {
    const exported = converter.movedSources.map((source) =>
      /^(export\s|type\s|interface\s)/.test(source) ? source : `export ${source}`,
    );
    const used = (name: string) => exported.some((source) => new RegExp(`\\b${name}\\b`).test(source));
    // Keep only the import specifiers the helpers actually use.
    const imports = converter.importSources
      .map((statement) => {
        const parsed = parse(statement, { sourceType: "module", plugins: ["typescript"] }) as unknown as Node;
        const decl = parsed.program.body[0];
        const specs = decl.specifiers.filter((spec: Node) => used(spec.local.name));
        if (specs.length === 0) return null;
        const def = specs.find((spec: Node) => spec.type === "ImportDefaultSpecifier");
        const named = specs.filter((spec: Node) => spec.type === "ImportSpecifier");
        const typeOnly = decl.importKind === "type" ? "type " : "";
        const parts = [
          def ? def.local.name : "",
          named.length
            ? `{ ${named.map((spec: Node) => (spec.imported.name === spec.local.name ? spec.local.name : `${spec.imported.name} as ${spec.local.name}`)).join(", ")} }`
            : "",
        ].filter(Boolean);
        return `import ${typeOnly}${parts.join(", ")} from "${decl.source.value}";`;
      })
      .filter(Boolean);
    const header = [
      "/**",
      ` * Helpers for the blog post content/blog/${slug}.mdx, moved out of the`,
      " * post's original page.tsx unchanged. Registered in components/blog/index.ts:",
      " * PascalCase exports are MDX components, the rest are reached from the post",
      " * as props.scope.<name>.",
      " */",
    ];
    await mkdir(BLOG_HELPERS_DIR, { recursive: true });
    await writeFile(file, [...header, ...imports, "", exported.join("\n\n"), ""].join("\n"));
  }
  await writeBlogHelperRegistry();
}

/** Regenerate components/blog/index.ts from the helper modules on disk. */
async function writeBlogHelperRegistry(): Promise<void> {
  const files = (await readdir(BLOG_HELPERS_DIR).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".tsx"))
    .sort();
  const ident = (slug: string) => `post_${slug.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const lines = [
    "// Generated by scripts/tsx-to-mdx.ts: per-post helpers for blog MDX.",
    "// Do not edit by hand; edit the helper module and keep this map in sync.",
    ...files.map((name) => `import * as ${ident(name.replace(/\.tsx$/, ""))} from "./${name.replace(/\.tsx$/, "")}";`),
    "",
    "/** Blog post slug → that post's helper exports (components and functions). */",
    "export const BLOG_POST_SCOPES: Record<string, Record<string, unknown>> = {",
    ...files.map((name) => `  ${JSON.stringify(name.replace(/\.tsx$/, ""))}: ${ident(name.replace(/\.tsx$/, ""))},`),
    "};",
    "",
  ];
  await mkdir(BLOG_HELPERS_DIR, { recursive: true });
  await writeFile(path.join(BLOG_HELPERS_DIR, "index.ts"), lines.join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const blog = args.includes("--blog");
  const files = args.filter((arg) => !arg.startsWith("--"));
  let failed = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    try {
      const converter = new Converter(source, file);
      const { mdx, route } = blog
        ? (({ mdx, slug }) => ({ mdx, route: `/blog/${slug}` }))(converter.convertBlog())
        : converter.convert();
      const body = mdx.replace(/^---\n[\s\S]*?\n---\n/, "");
      await compile(body, { remarkPlugins: [remarkGfm] });
      // "/docs" itself becomes content/docs/index.mdx; everything else maps
      // 1:1 (a section index /docs/security -> content/docs/security.mdx).
      const target =
        route === "/docs" ? path.join("content", "docs", "index.mdx") : path.join("content", `${route.replace(/^\//, "")}.mdx`);
      if (check) {
        console.log(`# ${file} -> ${target}\n${mdx}`);
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, mdx);
        if (blog) await writeBlogHelperModule(route.slice("/blog/".length), converter);
        // Remove only the page file; keep sibling files (e.g. opengraph-image)
        // and drop the folder only when nothing else lives there.
        await rm(file);
        if ((await readdir(path.dirname(file))).length === 0) await rmdir(path.dirname(file));
        // A section index converted before its children leaves the parent
        // folder behind; sweep empty ancestors once the children go.
        for (let dir = path.dirname(path.dirname(file)); dir.startsWith(path.join("app", blog ? "blog" : "docs", path.sep)); dir = path.dirname(dir)) {
          if ((await readdir(dir)).length > 0) break;
          await rmdir(dir);
        }
        console.log(`converted ${file} -> ${target}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
