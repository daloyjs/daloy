import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API lifecycle & breaking changes",
  description:
    "Deprecate and sunset DaloyJS routes with Deprecation and RFC 8594 Sunset headers, then catch breaking API changes in CI with diffOpenAPI, the daloy diff CLI, and the verify:breaking-changes gate.",
  path: "/docs/api-lifecycle",
  keywords: [
    "API versioning",
    "breaking change detection",
    "OpenAPI diff",
    "RFC 8594",
    "RFC 9745",
    "Deprecation header",
    "Sunset header",
    "deprecated route",
    "DaloyJS API lifecycle",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API lifecycle &amp; breaking changes</h1>
      <p>
        Because every DaloyJS endpoint is a single source of truth, the
        framework can answer two questions that usually need extra tooling:{" "}
        <em>&quot;how do I tell consumers an endpoint is going away?&quot;</em>{" "}
        and <em>&quot;did this change break my published API?&quot;</em> The
        first is solved with a route-level deprecation lifecycle; the second
        with an OpenAPI diff you can run in CI.
      </p>
      <p>
        If you are deciding how to run <code>/api/v1</code> and{" "}
        <code>/api/v2</code> side by side before retiring the older contract,
        start with the{" "}
        <Link href={"/docs/api-versioning" as Route}>API versioning guide</Link>
        .
      </p>

      <FlowDiagram
        title="Route deprecation lifecycle"
        caption="A route moves through these states. deprecated: true announces the intent and adds the Deprecation header; a sunset date adds the Sunset header and a hard removal target; only then do you delete the route. diffOpenAPI catches the final step if a consumer still depends on it."
        steps={[
          { label: "Active", detail: "no extra headers", tone: "success" },
          { label: "deprecated: true", detail: "Deprecation: true header" },
          { label: "sunset: <date>", detail: "Sunset: <IMF-fixdate> header" },
          { label: "Removed", detail: "route deleted after the sunset", tone: "danger" },
        ]}
      />

      <h2 id="deprecating-a-route">Deprecating a route</h2>
      <p>
        Set <code>deprecated: true</code> on a route to mark it in the OpenAPI
        document (the operation gets <code>deprecated: true</code>) and to emit
        a <code>Deprecation: true</code> response header on every response from
        that route.
      </p>
      <CodeBlock
        code={`app.get(
  "/v1/reports",
  {
    deprecated: true,
    responses: { 200: { description: "OK" } },
  },
  () => ({ status: 200, body: { ok: true } }),
);

// Response headers:
//   Deprecation: true`}
      />

      <h2 id="scheduling-a-sunset-date">Scheduling a sunset date</h2>
      <p>
        Add a <code>sunset</code> date to announce <em>when</em> the route will
        be removed. It accepts an ISO-8601 string, any string{" "}
        <code>new Date(...)</code> can parse, or a <code>Date</code>. A route
        with a <code>sunset</code> is implicitly deprecated, so you don&apos;t
        need to set both.
      </p>
      <CodeBlock
        code={`app.get(
  "/v1/reports",
  {
    sunset: "2026-12-31T00:00:00Z",
    responses: { 200: { description: "OK" } },
  },
  () => ({ status: 200, body: { ok: true } }),
);

// Response headers:
//   Deprecation: true
//   Sunset: Thu, 31 Dec 2026 00:00:00 GMT`}
      />
      <p>
        The RFC 8594 <code>Sunset</code> value is normalized to an IMF-fixdate
        (HTTP date) once, at route registration time, so
        a typo fails fast instead of silently shipping a malformed header. The
        OpenAPI operation also carries the normalized value as an{" "}
        <code>x-sunset</code> vendor extension. If your handler sets its own{" "}
        <code>Deprecation</code> or <code>Sunset</code> header, the framework
        never overwrites it. That lets teams emit a date-valued RFC 9745{" "}
        <code>Deprecation</code> header when they need that stricter form.
      </p>

      <h2 id="detecting-breaking-changes">Detecting breaking changes</h2>
      <p>
        <code>diffOpenAPI(baseline, current)</code> compares two OpenAPI 3.x
        documents and classifies every difference as <strong>breaking</strong>{" "}
        (a consumer relying on the baseline could now fail) or{" "}
        <strong>non-breaking</strong> (additive or informational). It is pure
        and dependency-free, so it runs anywhere you can read two JSON files.
      </p>
      <CodeBlock
        code={`import { diffOpenAPI, hasBreakingChanges } from "@daloyjs/core";
// or the focused entry point:
// import { diffOpenAPI } from "@daloyjs/core/openapi-diff";

const result = diffOpenAPI(publishedSpec, currentSpec);
// result.breaking:    OpenAPIChange[]
// result.nonBreaking: OpenAPIChange[]

if (hasBreakingChanges(publishedSpec, currentSpec)) {
  throw new Error("This change breaks the published API contract.");
}`}
      />
      <p>The diff flags these as breaking:</p>
      <ul>
        <li>
          a path or operation (HTTP method) present in the baseline is removed;
        </li>
        <li>a documented response status code is removed from an operation;</li>
        <li>
          a new <code>required</code> parameter is added to an existing
          operation;
        </li>
        <li>
          an existing optional parameter becomes <code>required</code>;
        </li>
        <li>
          an operation&apos;s request body becomes required when it was not.
        </li>
      </ul>
      <p>
        New paths, operations, response codes, and optional parameters,
        parameter removals, a newly <code>deprecated</code> operation, and an{" "}
        <code>info.version</code> bump are all reported as non-breaking.
      </p>

      <h2 id="the-daloy-diff-cli">The daloy diff CLI</h2>
      <p>
        The same engine ships as a CLI command so you can gate any two spec
        files without writing code. It prints the classified changes and exits{" "}
        <code>1</code> when a breaking change is found.
      </p>
      <CodeBlock
        language="bash"
        code={`# Compare the last published spec against the freshly generated one
daloy diff openapi.published.json openapi.json

# Machine-readable output for CI
daloy diff --json openapi.published.json openapi.json`}
      />

      <h2 id="wiring-it-into-ci">Wiring it into CI</h2>
      <p>
        Commit your published spec as a baseline (e.g.{" "}
        <code>generated/openapi.baseline.json</code>) and run the{" "}
        <code>verify:breaking-changes</code> gate. It compares the baseline
        against the freshly generated <code>generated/openapi.json</code> and
        fails the build on any breaking change. When no baseline exists yet the
        gate is a no-op, so you can adopt it incrementally.
      </p>
      <FlowDiagram
        title="Breaking-change CI gate"
        numbered
        caption="The same diff engine the library exposes runs as a CI gate. A breaking change fails the build (exit 1); additive changes pass. With no committed baseline the gate is a no-op, so adoption is incremental."
        steps={[
          { label: "pnpm gen", detail: "regenerate generated/openapi.json" },
          { label: "baseline", detail: "generated/openapi.baseline.json" },
          { label: "diffOpenAPI", detail: "classify every change", tone: "accent" },
          { label: "breaking?", detail: "fail CI ⟋ pass build" },
        ]}
      />
      <CodeBlock
        language="bash"
        code={`pnpm gen                      # regenerate generated/openapi.json
pnpm verify:breaking-changes  # fail CI if the published contract is broken`}
      />

      <p>
        See also <Link href="/docs/openapi">OpenAPI generation</Link> for how
        the spec is produced and{" "}
        <Link href="/docs/typed-client">typed clients</Link> for how consumers
        pick up the contract.
      </p>
    </>
  );
}
