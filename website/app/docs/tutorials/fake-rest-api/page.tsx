import Link from "next/link";

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

      <h2>Live demo</h2>
      <p>
        Explore the public demo at{" "}
        <a href="https://fakerestapi.vercel.app/index.html" target="_blank" rel="noreferrer">
          fakerestapi.vercel.app
        </a>
        .
      </p>

      <h2>Why this lives here</h2>
      <ul>
        <li>It is a product demo, not part of the framework API surface.</li>
        <li>A catalog with roughly 600 endpoints is too large for the core docs sidebar structure.</li>
        <li>Users looking at OpenAPI, client generation, and docs rendering need a realistic large example.</li>
      </ul>

      <h2>What to use it for</h2>
      <ul>
        <li>Pressure-test docs UIs and endpoint navigation with a non-trivial API size.</li>
        <li>Verify OpenAPI generation and downstream codegen workflows on a large contract.</li>
        <li>Exercise typed SDK generation and sample integrations before exposing your own API.</li>
        <li>Show prospective users that DaloyJS scales beyond toy examples.</li>
      </ul>

      <h2>Recommended information architecture</h2>
      <p>
        Keep this page in the docs as the entry point, and host the actual explorer as a separate live surface
        such as <code>demo.daloyjs.dev</code> or <code>api-demo.daloyjs.dev</code>. The docs page should explain
        the purpose of the demo, link to the live explorer, and link back into the relevant DaloyJS guides.
      </p>

      <h2>Where to continue</h2>
      <p>
        Pair this demo with <Link href="/docs/openapi">OpenAPI generation</Link>,{" "}
        <Link href="/docs/typed-client">typed clients</Link>, and the{" "}
        <Link href="/docs/tutorials/bookstore">Bookstore tutorial</Link> for a smaller end-to-end build.
      </p>
    </>
  );
}