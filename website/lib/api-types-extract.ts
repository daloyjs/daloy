/**
 * Build-time extraction of TSDoc'd declarations from the framework source, for
 * the `<AutoTypeTable>` snapshot. Script and test use only: it reads `../src`,
 * which the Vercel website build does not have. The site renders from
 * `lib/api-types.snapshot.json` via `getApiProperties` in `api-types.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "@babel/parser";

import type { ApiProperty } from "./api-types";

/** Repository root (the website lives in `website/`). */
const REPO_ROOT = path.resolve(process.cwd(), "..");

type Node = { type: string; start?: number | null; end?: number | null; [key: string]: any };

/**
 * Parse a TSDoc block comment body into summary and tags.
 *
 * @param raw - The comment value without the surrounding delimiters.
 * @returns The summary text and a tag → text map (first occurrence wins).
 */
export function parseTsDoc(raw: string): { summary: string; tags: Map<string, string> } {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .join("\n")
    .trim()
    .split("\n");
  const summary: string[] = [];
  const tags = new Map<string, string>();
  let current: { name: string; lines: string[] } | null = null;

  const flush = () => {
    if (current && !tags.has(current.name)) tags.set(current.name, current.lines.join(" ").trim());
  };

  for (const line of lines) {
    const tag = /^@(\w+)\s*(.*)$/.exec(line);
    if (tag) {
      flush();
      current = { name: tag[1]!, lines: [tag[2] ?? ""] };
    } else if (current) {
      current.lines.push(line);
    } else {
      summary.push(line);
    }
  }
  flush();

  const text = summary
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

  return { summary: resolveLinks(text), tags };
}

/** `{@link Foo}`, `{@link Foo | label}`, `{@link "./x.js".Bar}` → readable text. */
function resolveLinks(text: string): string {
  return text.replace(/\{@link(?:code|plain)?\s+([^}|]+?)(?:\s*\|\s*([^}]+))?\}/g, (_, target: string, label?: string) => {
    if (label) return label.trim();
    const name = target.trim().replace(/^"[^"]+"\./, "");
    return `\`${name}\``;
  });
}

/**
 * Read a declaration straight from the framework source. Only works in a full
 * checkout (the snapshot generator and tests use it; the site build does not).
 *
 * @param file - Repo-relative path inside the repository.
 * @param name - The interface or type alias name.
 * @returns The properties.
 * @throws {Error} When the path escapes the repository or the declaration is missing.
 */
export async function readApiProperties(file: string, name: string): Promise<ApiProperty[]> {
  const absolute = path.resolve(REPO_ROOT, file);
  if (!absolute.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`AutoTypeTable: ${file} is outside the repository`);
  }
  const source = await readFile(absolute, "utf8");
  return extractApiProperties(source, name, file);
}

/**
 * Pure core of {@link readApiProperties}, exported for tests.
 *
 * @param source - TypeScript source text.
 * @param name - Declaration to extract.
 * @param file - File label for error messages.
 * @returns The documented properties.
 */
export function extractApiProperties(source: string, name: string, file = "<source>"): ApiProperty[] {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] }) as unknown as Node;
  const text = (node: Node) => source.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, " ").trim();

  let members: Node[] | null = null;
  for (const statement of ast.program.body as Node[]) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (!declaration) continue;
    if (declaration.type === "TSInterfaceDeclaration" && declaration.id.name === name) {
      members = declaration.body.body;
    } else if (
      declaration.type === "TSTypeAliasDeclaration" &&
      declaration.id.name === name &&
      declaration.typeAnnotation.type === "TSTypeLiteral"
    ) {
      members = declaration.typeAnnotation.members;
    }
  }
  if (!members) throw new Error(`AutoTypeTable: no interface or object type "${name}" in ${file}`);

  return members
    .filter((member) => member.type === "TSPropertySignature" || member.type === "TSMethodSignature")
    .map((member) => {
      const doc = [...(member.leadingComments ?? [])].reverse().find((comment: Node) => comment.type === "CommentBlock" && comment.value.startsWith("*"));
      const { summary, tags } = doc ? parseTsDoc(doc.value.slice(1)) : { summary: "", tags: new Map<string, string>() };
      const propName = member.key.type === "Identifier" ? member.key.name : text(member.key);
      const type =
        member.type === "TSMethodSignature"
          ? `(${member.parameters.map((p: Node) => text(p)).join(", ")}) => ${member.typeAnnotation ? text(member.typeAnnotation.typeAnnotation) : "void"}`
          : member.typeAnnotation
            ? text(member.typeAnnotation.typeAnnotation)
            : "unknown";
      const property: ApiProperty = {
        name: propName,
        type,
        required: !member.optional,
        description: summary,
      };
      const defaultValue = tags.get("default") ?? tags.get("defaultValue");
      if (defaultValue) property.default = defaultValue.replace(/^`|`$/g, "");
      if (tags.has("deprecated")) property.deprecated = tags.get("deprecated") ?? "";
      if (tags.get("since")) property.since = tags.get("since");
      return property;
    });
}
