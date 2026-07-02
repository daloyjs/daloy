import Link from "next/link";

import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Demo: large fake REST API",
  description:
    "Explore a large DaloyJS-style demo API with hundreds of endpoints. Use it to test OpenAPI tooling, typed client generation, docs UX, and navigation at real-world scale.",
  path: "/docs/tutorials/fake-rest-api",
  keywords: ["DaloyJS demo API", "large OpenAPI demo", "fake REST API", "typed client demo"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Demo: large fake REST API</h1>
      <p>
        This is the right home for the big public demo API: a dedicated tutorial-style landing page in the
        docs, with the actual interactive explorer hosted separately. That keeps the DaloyJS docs focused
        while still giving users a realistic large-spec environment to test against.
      </p>

      <h2 id="live-demo">Live demo</h2>
      <p>
        Explore the public demo at{" "}
        <a href="https://fakerestapi.vercel.app/index.html" target="_blank" rel="noreferrer">
          fakerestapi.vercel.app
        </a>
        .
      </p>

      <h2 id="why-this-lives-here">Why this lives here</h2>
      <ul>
        <li>It is a product demo, not part of the framework API surface.</li>
        <li>A catalog with roughly 600 endpoints is too large for the core docs sidebar structure.</li>
        <li>Users looking at OpenAPI, client generation, and docs rendering need a realistic large example.</li>
      </ul>

      <BranchDiagram
        title="One large spec, many things to test"
        source={{
          eyebrow: "~600 endpoints",
          label: "Large OpenAPI contract",
          detail: "realistic, non-trivial API size",
        }}
        branches={[
          {
            eyebrow: "humans",
            label: "Docs UI & navigation",
            detail: "pressure-test endpoint browsing",
          },
          {
            eyebrow: "codegen",
            label: "Typed client generation",
            detail: "Hey API SDK at scale",
          },
          {
            eyebrow: "integration",
            label: "Sample integrations",
            detail: "exercise before exposing your own API",
          },
        ]}
        caption="The demo exists so you can validate OpenAPI tooling, typed client codegen, and docs UX against a realistic large contract instead of a toy example."
      />

      <h2 id="what-to-use-it-for">What to use it for</h2>
      <ul>
        <li>Pressure-test docs UIs and endpoint navigation with a non-trivial API size.</li>
        <li>Verify OpenAPI generation and downstream codegen workflows on a large contract.</li>
        <li>Exercise typed SDK generation and sample integrations before exposing your own API.</li>
        <li>Show prospective users that DaloyJS scales beyond toy examples.</li>
      </ul>

      <h2 id="recommended-information-architecture">Recommended information architecture</h2>
      <p>
        Keep this page in the docs as the entry point, and host the actual explorer as a separate live surface
        such as <code>demo.daloyjs.dev</code> or <code>api-demo.daloyjs.dev</code>. The docs page should explain
        the purpose of the demo, link to the live explorer, and link back into the relevant DaloyJS guides.
      </p>

      <h2 id="where-to-continue">Where to continue</h2>
      <p>
        Pair this demo with <Link href="/docs/openapi">OpenAPI generation</Link>,{" "}
        <Link href="/docs/typed-client">typed clients</Link>, and the{" "}
        <Link href="/docs/tutorials/bookstore">Bookstore tutorial</Link> for a smaller end-to-end build.
      </p>
    </>
  );
}