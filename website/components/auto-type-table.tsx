import type { ReactNode } from "react";

import { getApiProperties } from "@/lib/api-types";
import { REPO_BRANCH, REPO_URL } from "@/lib/docs-page-meta-shared";

import { TypeTable, type TypeTableEntry } from "./type-table";

/**
 * Render TSDoc prose: backtick spans become `<code>`, blank-line paragraphs
 * become line breaks. Built as React nodes, never as HTML, so source comments
 * cannot inject markup.
 */
function renderDoc(text: string): ReactNode {
  return text.split("\n\n").map((paragraph, index) => (
    <span key={index} className="block [&+&]:mt-2">
      {paragraph.split(/(`[^`]+`)/g).map((part, partIndex) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={partIndex}>{part.slice(1, -1)}</code>
        ) : (
          part
        )
      )}
    </span>
  ));
}

/** Props accepted by {@link AutoTypeTable}. */
export interface AutoTypeTableProps {
  /** Repo-relative source file, e.g. `"src/middleware.ts"`. */
  path: string;
  /** Exported interface or object type alias, e.g. `"RateLimitOptions"`. */
  name: string;
}

/**
 * A {@link TypeTable} generated from the framework source at build time:
 * property names, types, optionality and TSDoc (including `@default`,
 * `@deprecated` and `@since`) come straight from `src/`, so the docs table
 * cannot drift from the code. Links to the declaration on GitHub.
 *
 * @example
 * <AutoTypeTable path="src/middleware.ts" name="RateLimitOptions" />
 */
export async function AutoTypeTable({ path, name }: AutoTypeTableProps) {
  const properties = await getApiProperties(path, name);
  const rows = Object.fromEntries(
    properties.map((property) => [
      property.name,
      {
        type: property.type,
        required: property.required,
        default: property.default,
        deprecated: property.deprecated,
        description: (
          <>
            {renderDoc(property.description)}
            {property.since ? <span className="mt-1 block text-xs">Since {property.since}</span> : null}
          </>
        ),
      } satisfies TypeTableEntry,
    ])
  );

  return (
    <figure className="not-prose my-6">
      <TypeTable type={rows} className="my-0" />
      <figcaption className="mt-2 text-xs text-muted-foreground">
        Generated from{" "}
        <a
          href={`${REPO_URL}/blob/${REPO_BRANCH}/${path}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono underline underline-offset-4"
        >
          {name}
        </a>{" "}
        in <code className="font-mono">{path}</code>.
      </figcaption>
    </figure>
  );
}
