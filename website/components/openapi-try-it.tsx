"use client";

import * as React from "react";

import { Button } from "./ui/button";

/** Cap on the response body shown, so a large payload cannot freeze the page. */
const MAX_BODY_CHARS = 8_000;

type Result = { status: number; statusText: string; contentType: string; url: string; body: string };

/**
 * Format a response body for display: pretty JSON when it parses, otherwise
 * the raw text, truncated to {@link MAX_BODY_CHARS}.
 *
 * @param text - Raw response text.
 * @returns Display text.
 */
export function formatBody(text: string): string {
  let out = text;
  try {
    out = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON: show as-is.
  }
  return out.length > MAX_BODY_CHARS ? `${out.slice(0, MAX_BODY_CHARS)}\n… (truncated)` : out;
}

/**
 * "Try it" for a public, parameterless GET on this site's own API.
 *
 * Deliberately narrow: the request always goes to a **same-origin, relative**
 * path baked in at build time (never a user-typed URL), so there is no proxy
 * and no SSRF surface, the site's CSP (`connect-src 'self'`) allows it, and
 * nothing the reader types is sent anywhere. The response is rendered as
 * text, never as HTML.
 *
 * @param props.path - Same-origin path, e.g. `/.well-known/api-catalog`.
 */
export function OpenApiTryIt({ path }: { path: string }) {
  const [state, setState] = React.useState<{ loading: boolean; result?: Result; error?: string }>({ loading: false });

  if (!path.startsWith("/") || path.startsWith("//")) return null;

  async function run() {
    setState({ loading: true });
    try {
      const response = await fetch(path, { method: "GET", credentials: "omit", headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" } });
      setState({
        loading: false,
        result: {
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type") ?? "",
          url: new URL(response.url).pathname,
          body: formatBody(await response.text()),
        },
      });
    } catch {
      setState({ loading: false, error: "Request failed. Check your connection and try again." });
    }
  }

  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={state.loading}>
          {state.loading ? "Sending…" : "Try it"}
        </Button>
        <code className="font-mono text-xs text-muted-foreground">GET {path}</code>
        {state.result ? (
          <span role="status" className="font-mono text-xs">
            {state.result.status} {state.result.statusText}
            {state.result.url !== path ? ` (from ${state.result.url})` : ""}
            {state.result.contentType ? ` · ${state.result.contentType.split(";")[0]}` : ""}
          </span>
        ) : null}
        {state.error ? (
          <span role="status" className="text-xs text-rose-600 dark:text-rose-400">
            {state.error}
          </span>
        ) : null}
      </div>
      {state.result ? (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
          {state.result.body || "(empty body)"}
        </pre>
      ) : null}
    </div>
  );
}
