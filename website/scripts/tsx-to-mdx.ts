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
import GithubSlugger from "github-slugger";
import remarkGfm from "remark-gfm";
import { stringify as stringifyYaml } from "yaml";

type Node = { type: string; start?: number | null; end?: number | null; [key: string]: any };

/** Components the MDX renderer provides globally, plus the imports that are safe to drop. */
const PROVIDED = new Set([
  "AuthRole", "AutoTypeTable", "BranchDiagram", "Callout", "Card", "Cards", "CodeBlock", "Diagram", "File", "Files",
  "FlowDiagram", "Folder", "IdpBoundary", "LayerStack", "Link", "PackageInstall", "SequenceDiagram", "SiteApiReference",
  "Step", "Steps", "TypeTable", "UseCaseGuide",
]);
const DROPPABLE_IMPORTS = new Set(["buildMetadata", "Route", "Metadata"]);

const ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–",
  rarr: "→", larr: "←", hellip: "…", middot: "·", times: "×", copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? match;
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
  return text
    .replace(/[\\`*_[\]<>{}]/g, (c) => `\\${c}`)
    .replace(/&(?=[a-z#][a-z0-9]*;)/gi, "\\&");
}

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
      if (value.type === "Identifier" && this.consts.has(value.name)) this.usedConsts.add(value.name);
      if (value.type === "JSXIdentifier" && /^[A-Z]/.test(value.name) && !PROVIDED.has(value.name)) {
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
    const cuts: Array<[number, number]> = [];
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
      }
      for (const key of Object.keys(value)) {
        if (key !== "loc" && key !== "extra") visit(value[key]);
      }
    };
    visit(node);
    let out = "";
    let cursor = node.start ?? 0;
    for (const [from, to] of cuts.sort((a, b) => a[0] - b[0])) {
      if (from < cursor) continue;
      out += this.source.slice(cursor, from);
      cursor = to;
    }
    return out + this.source.slice(cursor, node.end ?? 0);
  }

  private verbatim(node: Node): string {
    this.collectIdentifiers(node);
    const text = this.jsText(node);
    // Dedent continuation lines by the element's own column so the JSX reads
    // naturally at the top level of the MDX file.
    const column: number = node.loc?.start?.column ?? 0;
    if (column === 0 || !text.includes("\n")) return text;
    const pattern = new RegExp(`\\n {1,${column}}`, "g");
    return text.replace(pattern, "\n");
  }

  private isBlank(node: Node): boolean {
    return node.type === "JSXText" && node.value.trim() === "";
  }

  // ---------- inline ----------

  inline(children: Node[]): string {
    let out = "";
    for (const child of children) out += this.inlineNode(child);
    return out.replace(/\s+/g, " ");
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
      return this.verbatim(node);
    }
    if (node.type !== "JSXElement") return this.verbatim(node);

    const name = this.name(node);
    const attrs = this.attrs(node);
    switch (name) {
      case "code": {
        if (attrs.size > 0) return this.verbatim(node);
        const code = this.plainText(node.children);
        const fence = code.includes("`") ? "``" : "`";
        const pad = fence.length > 1 || code.startsWith("`") || code.endsWith("`") ? " " : "";
        return `${fence}${pad}${code}${pad}${fence}`;
      }
      case "strong":
      case "b":
        return attrs.size > 0 ? this.verbatim(node) : this.wrap("**", this.inline(node.children));
      case "em":
      case "i":
        return attrs.size > 0 ? this.verbatim(node) : this.wrap("*", this.inline(node.children));
      case "a":
      case "Link": {
        const href = this.stringValue(attrs.get("href"));
        const allowed = [...attrs.keys()].every((key) => ["href", "target", "rel"].includes(key));
        if (!href || !allowed) return this.verbatim(node);
        const external = /^https?:\/\//.test(href);
        // Internal <a> and target=_blank on internal links would change behavior; keep those verbatim.
        if (!external && name === "a" && attrs.has("target")) return this.verbatim(node);
        const label = this.inline(node.children).trim();
        return `[${label}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
      }
      case "br":
        return "<br />";
      default:
        return this.verbatim(node);
    }
  }

  // ---------- blocks ----------

  private isInlineElement(node: Node): boolean {
    if (node.type === "JSXText" || node.type === "JSXExpressionContainer") return true;
    if (node.type !== "JSXElement") return false;
    return ["code", "strong", "b", "em", "i", "a", "Link", "br", "span", "kbd", "abbr", "sup", "sub"].includes(this.name(node));
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
      const slug = this.slugger.slug(plain);
      const marker = id && id !== slug ? ` [#${id}]` : "";
      if (id && id !== slug) this.slugger.slug(id);
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

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = args.filter((arg) => !arg.startsWith("--"));
  let failed = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    try {
      const { mdx, route } = new Converter(source, file).convert();
      const body = mdx.replace(/^---\n[\s\S]*?\n---\n/, "");
      await compile(body, { remarkPlugins: [remarkGfm] });
      const target = path.join("content", `${route.replace(/^\//, "")}.mdx`);
      if (check) {
        console.log(`# ${file} -> ${target}\n${mdx}`);
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, mdx);
        // Remove only the page file; keep sibling files (e.g. opengraph-image)
        // and drop the folder only when nothing else lives there.
        await rm(file);
        if ((await readdir(path.dirname(file))).length === 0) await rmdir(path.dirname(file));
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
