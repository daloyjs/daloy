import GithubSlugger from "github-slugger";
import type { Code, Heading, Parent, Root, RootContent, Text } from "mdast";
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import { toString } from "mdast-util-to-string";

/**
 * Trailing custom-id marker on a heading, e.g. `## Install it [#install]`.
 * Used when a heading's anchor must stay stable (inbound links) even though
 * its text no longer slugifies to it.
 */
const CUSTOM_ID = /\s*\[#([A-Za-z0-9][\w-]*)\]\s*$/;

/**
 * Parsed code-fence meta string: `title="app.ts" {1,3-4} lineNumbers dev`.
 */
export type CodeMeta = {
  title?: string;
  highlight?: string;
  lineNumbers: boolean;
  flags: Set<string>;
};

/**
 * Parse a fenced code block's meta string (everything after the language).
 *
 * Supports `title="…"` (or `title='…'`), a `{…}` line-highlight spec, and bare
 * flags such as `lineNumbers` or `dev`.
 *
 * @param meta - The raw meta string, or `null`/`undefined` when absent.
 * @returns The parsed options.
 */
export function parseCodeMeta(meta: string | null | undefined): CodeMeta {
  const result: CodeMeta = { lineNumbers: false, flags: new Set() };
  if (!meta) return result;

  let rest = meta.replace(/\btitle=(?:"([^"]*)"|'([^']*)')/, (_, double: string | undefined, single: string | undefined) => {
    result.title = double ?? single ?? "";
    return " ";
  });
  rest = rest.replace(/\{([\d,\s-]+)\}/, (_, spec: string) => {
    result.highlight = spec.replace(/\s+/g, "");
    return " ";
  });
  for (const flag of rest.split(/\s+/).filter(Boolean)) {
    if (flag === "lineNumbers") result.lineNumbers = true;
    else result.flags.add(flag);
  }

  return result;
}

function attr(name: string, value: string | null): MdxJsxAttribute {
  return { type: "mdxJsxAttribute", name, value };
}

function jsxElement(name: string, attributes: MdxJsxAttribute[]): MdxJsxFlowElement {
  return { type: "mdxJsxFlowElement", name, attributes, children: [] };
}

/**
 * Turn a fenced code block into the matching docs component:
 *
 * - ` ```package-install ` → `<PackageInstall packages="…" />` (add `dev` for `-D`)
 * - any other language → `<CodeBlock code="…" language="…" />` with `title`,
 *   `highlight` (`{1,3-5}`) and `lineNumbers` taken from the meta string.
 *
 * @param node - The mdast `code` node.
 * @returns The replacement JSX element.
 */
export function codeNodeToElement(node: Code): MdxJsxFlowElement {
  const meta = parseCodeMeta(node.meta);

  if (node.lang === "package-install") {
    const attributes = [attr("packages", node.value.trim().split(/\s+/).join(" "))];
    if (meta.flags.has("dev")) attributes.push(attr("dev", null));
    return jsxElement("PackageInstall", attributes);
  }

  const attributes = [attr("code", node.value), attr("language", node.lang ?? "text")];
  if (meta.title) attributes.push(attr("title", meta.title));
  if (meta.highlight) attributes.push(attr("highlight", meta.highlight));
  if (meta.lineNumbers) attributes.push(attr("lineNumbers", null));
  return jsxElement("CodeBlock", attributes);
}

/**
 * Give every `h2`–`h4` a stable `id`: the trailing `[#custom]` marker when
 * present (removed from the rendered text), otherwise a GitHub-compatible slug
 * of the heading text, de-duplicated within the page.
 *
 * @param heading - The mdast heading node (mutated in place).
 * @param slugger - Per-document slugger, so duplicate headings get `-1`, `-2`.
 */
export function assignHeadingId(heading: Heading, slugger: GithubSlugger): void {
  let id: string | undefined;
  const last = heading.children.at(-1);

  if (last?.type === "text") {
    const match = CUSTOM_ID.exec((last as Text).value);
    if (match) {
      id = match[1];
      (last as Text).value = (last as Text).value.slice(0, match.index);
      slugger.slug(id); // reserve it so a later identical heading is suffixed
    }
  }

  id ??= slugger.slug(toString(heading));
  heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id } };
}

function walk(parent: Parent, slugger: GithubSlugger): void {
  parent.children.forEach((child: RootContent, index: number) => {
    if (child.type === "code") {
      (parent.children as RootContent[])[index] = codeNodeToElement(child);
      return;
    }
    if (child.type === "heading" && child.depth >= 2 && child.depth <= 4) {
      assignHeadingId(child, slugger);
    }
    if ("children" in child && Array.isArray(child.children)) {
      walk(child as Parent, slugger);
    }
  });
}

/**
 * Remark plugin with the site's markdown conventions: heading anchors and
 * code fences rendered through `CodeBlock` / `PackageInstall`.
 *
 * @returns The unified transformer.
 */
export default function remarkDaloy() {
  return (tree: Root) => {
    walk(tree, new GithubSlugger());
  };
}
