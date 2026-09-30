import { CodeBlock } from "./code-block";
import { CodeTabs } from "./code-tabs";
import { OpenApiTryIt } from "./openapi-try-it";
import { TypeTable, type TypeTableEntry } from "./type-table";

import { buildOperations, requestSamples, type OperationView, type SchemaRow } from "@/lib/openapi-view";
import { cn } from "@/lib/utils";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  POST: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  PUT: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  PATCH: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  DELETE: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

function rowsToTable(rows: readonly SchemaRow[]): Record<string, TypeTableEntry> {
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      { type: row.type, required: row.required, default: row.default, description: row.description },
    ])
  );
}

function statusTone(status: string): string {
  if (status.startsWith("2")) return "text-emerald-700 dark:text-emerald-300";
  if (status.startsWith("3")) return "text-sky-700 dark:text-sky-300";
  if (status.startsWith("4") || status.startsWith("5")) return "text-rose-700 dark:text-rose-300";
  return "text-muted-foreground";
}

/** Props accepted by {@link OpenApiReference}. */
export interface OpenApiReferenceProps {
  /** A parsed OpenAPI 3.x document. */
  spec: Record<string, unknown>;
  /** Base URL used in the generated request samples. */
  baseUrl: string;
  /**
   * Enable "Try it" for public, parameterless GET operations. Requests go to
   * the **same origin** as the docs page, so only enable this for a spec
   * that this site itself serves.
   */
  tryIt?: boolean;
}

/**
 * Server-rendered API reference for an OpenAPI 3.x document, in the spirit of
 * Fumadocs' OpenAPI pages: operations grouped by tag, each with its method
 * and path, parameters, request body and responses as type tables, and
 * curl / fetch samples in synced tabs. Every operation heading gets an
 * anchor (its `operationId`), so operations appear in the "On this page" TOC
 * and can be deep-linked.
 */
export function OpenApiReference({ spec, baseUrl, tryIt = false }: OpenApiReferenceProps) {
  const operations = buildOperations(spec);
  const tags = Array.isArray(spec.tags)
    ? (spec.tags as Array<{ name?: string; description?: string }>).filter((tag) => typeof tag.name === "string")
    : [];
  const order = [...tags.map((tag) => tag.name!), ...new Set(operations.map((op) => op.tag))];
  const groups = [...new Set(order)]
    .map((name) => ({
      name,
      description: tags.find((tag) => tag.name === name)?.description,
      operations: operations.filter((op) => op.tag === name),
    }))
    .filter((group) => group.operations.length > 0);

  return (
    <div data-openapi-reference>
      {groups.map((group) => (
        <section key={group.name}>
          <h2 id={`tag-${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{group.name}</h2>
          {group.description ? <p>{group.description}</p> : null}
          {group.operations.map((op) => (
            <Operation key={op.id} op={op} baseUrl={baseUrl} tryIt={tryIt} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Operation({ op, baseUrl, tryIt }: { op: OperationView; baseUrl: string; tryIt: boolean }) {
  const samples = requestSamples(op, baseUrl);
  const canTry = tryIt && op.method === "GET" && !op.requiresAuth && !op.path.includes("{");

  return (
    <article className="mt-10 border-t pt-8" data-operation={op.id}>
      <h3 id={op.id} className="mt-0!">
        {op.summary}
      </h3>
      <p className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 font-mono text-xs font-semibold",
            METHOD_STYLES[op.method] ?? "bg-muted text-foreground"
          )}
        >
          {op.method}
        </span>
        <code>{op.path}</code>
        {op.requiresAuth ? (
          <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Requires a token
          </span>
        ) : op.optionalAuth ? (
          <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
            Token optional
          </span>
        ) : null}
        {op.deprecated ? (
          <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
            Deprecated
          </span>
        ) : null}
      </p>
      {op.description ? <p>{op.description}</p> : null}

      {op.parameters.length > 0 ? (
        <>
          <h4>Parameters</h4>
          <TypeTable
            type={Object.fromEntries(
              op.parameters.map((param) => [
                param.name,
                {
                  type: param.type,
                  required: param.required,
                  description: (
                    <>
                      <span className="me-1 font-mono text-[11px] uppercase">{param.in}</span>
                      {param.description}
                    </>
                  ),
                },
              ])
            )}
          />
        </>
      ) : null}

      {op.requestBody ? (
        <>
          <h4>
            Request body <code>{op.requestBody.contentType}</code>
          </h4>
          {op.requestBody.rows.length > 0 ? <TypeTable type={rowsToTable(op.requestBody.rows)} /> : null}
        </>
      ) : null}

      <h4>Responses</h4>
      <ul className="not-prose my-3 space-y-3">
        {op.responses.map((response) => (
          <li key={response.status} className="rounded-xl border p-3 text-sm">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className={cn("font-mono font-semibold", statusTone(response.status))}>{response.status}</span>
              <span className="text-foreground/90">{response.description}</span>
              {response.contentType ? <code className="text-xs text-muted-foreground">{response.contentType}</code> : null}
            </p>
            {response.rows.length > 0 ? <TypeTable type={rowsToTable(response.rows)} className="mb-0" /> : null}
            {response.headers.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Headers ({response.headers.length})</summary>
                <TypeTable type={rowsToTable(response.headers)} className="mb-0" />
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      <h4>Example request</h4>
      <CodeTabs
        labels={["curl", "fetch"]}
        storageKey="daloy:request-sample"
        label="Request sample language"
        panels={[
          <CodeBlock key="curl" code={samples.curl} language="bash" className="my-0" />,
          <CodeBlock key="fetch" code={samples.fetch} language="ts" className="my-0" />,
        ]}
      />
      {canTry ? <OpenApiTryIt path={op.path} /> : null}
    </article>
  );
}
