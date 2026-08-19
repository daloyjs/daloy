import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "llms.txt for agent-readable docs",
  description:
    "Ship a curated /llms.txt map so coding agents and LLM tools find DaloyJS docs without scraping HTML. Covers the v2 spec: link relations for discovery, both markdown URL forms, subpath coverage, and how daloyjs.dev generates its index from the same nav as the human docs UI.",
  path: "/docs/llms-txt",
  keywords: [
    "llms.txt",
    "llmstxt",
    "AI documentation",
    "agent-readable docs",
    "DaloyJS llms.txt",
    "markdown docs for LLMs",
    "robots.txt vs llms.txt",
    "llms.txt v2",
    "rel=describedby",
    "rel=alternate text/markdown",
    "MCP docs",
  ],
  type: "article",
});

const EXAMPLE = `# DaloyJS

> Runtime-portable, contract-first TypeScript web framework with OpenAPI 3.1,
> typed clients, and security-first defaults.

Current release notes and package pins live on the homepage and CHANGELOG.

## Docs

- [Getting started](https://daloyjs.dev/docs/getting-started.md): first route and test
- [Routing](https://daloyjs.dev/docs/routing.md): contract-first app.route shape
- [MCP](https://daloyjs.dev/docs/mcp.md): runtime tool surface for agents

## Project

- [Docs MCP server](https://daloyjs.dev/mcp): search_docs / get_doc / list_docs
- [npm @daloyjs/core](https://www.npmjs.com/package/@daloyjs/core): published package

## Optional

- [Blog](https://daloyjs.dev/blog): design write-ups and release posts
`;

const LINK_HEADER = `Link: </docs/routing.md>; rel="alternate"; type="text/markdown",
      </docs/llms.txt>; rel="describedby"`;

const LINK_ELEMENTS = `<link rel="alternate" type="text/markdown" href="/docs/routing.md">
<link rel="describedby" href="/docs/llms.txt">`;

export default function Page() {
  return (
    <>
      <h1>llms.txt for agent-readable docs</h1>
      <p>
        <code>/llms.txt</code> is a proposed convention (
        <a href="https://llmstxt.org/" rel="noopener noreferrer">
          llmstxt.org
        </a>
        ) for a Markdown file at a well-known path that gives LLMs and coding
        agents a short, curated map of a site. It is not a sitemap dump and not
        a ranking signal. It is a token-efficient index: project summary, the
        links that matter, and optional secondary material agents can skip when
        context is tight.
      </p>
      <p>
        This page tracks <strong>v2</strong> of the proposal, published on 10
        August 2026 and the first revision since the format appeared in 2024.
        The file skeleton did not change, so a valid v1 file is still a valid v2
        file. What changed is everything <em>around</em> the file:{" "}
        <a href="https://llmstxt.org/changes.html" rel="noopener noreferrer">
          how agents discover it
        </a>
        {", "}where markdown versions are allowed to live, and what a file in a
        subpath means. See{" "}
        <Link href="/docs/llms-txt#v2">What changed in v2</Link> below.
      </p>
      <p>
        DaloyJS already ships one for the project site at{" "}
        <a href="https://daloyjs.dev/llms.txt" rel="noopener noreferrer">
          https://daloyjs.dev/llms.txt
        </a>
        . Every docs page also has a Markdown sibling (append <code>.md</code>{" "}
        to the HTML URL). The index is generated from the same docs nav the
        human UI uses, so the map and the site cannot silently disagree about
        which pages exist.
      </p>

      <BranchDiagram
        title="Four different agent surfaces"
        source={{
          eyebrow: "your product",
          label: "DaloyJS project",
          detail: "repo + docs + API + tools",
        }}
        branches={[
          {
            eyebrow: "edit time",
            label: "AGENTS.md + skills",
            detail: "local conventions in the repo",
          },
          {
            eyebrow: "public docs",
            label: "/llms.txt + .md pages",
            detail: "curated map for inference-time readers",
          },
          {
            eyebrow: "contract",
            label: "OpenAPI + meta / inspect --ai",
            detail: "machine API shape and examples",
          },
          {
            eyebrow: "runtime",
            label: "MCP tools",
            detail: "authenticated actions agents call live",
          },
        ]}
        caption="llms.txt answers where to read. AGENTS.md answers how to edit. OpenAPI answers how to call HTTP. MCP answers which tools exist at runtime. Keep those jobs separate."
      />

      <h2 id="what-it-is">What it is (and is not)</h2>
      <ul>
        <li>
          <strong>Is:</strong> a curated Markdown index at{" "}
          <code>/llms.txt</code>, optionally paired with clean <code>.md</code>{" "}
          versions of linked pages.
        </li>
        <li>
          <strong>Is not:</strong> a replacement for <code>robots.txt</code>{" "}
          (access policy for crawlers).
        </li>
        <li>
          <strong>Is not:</strong> a replacement for <code>sitemap.xml</code>{" "}
          (exhaustive indexable URLs).
        </li>
        <li>
          <strong>Is not:</strong> a guaranteed boost in ChatGPT or Google AI
          citations. Major model providers have not committed to treating it
          like <code>robots.txt</code>. Chrome Lighthouse includes an
          experimental agentic-browsing check that fails only on server errors
          for the path; a missing file is treated as not applicable.
        </li>
      </ul>
      <p>
        Use it so coding agents, IDE helpers, and research tools that{" "}
        <em>do</em> fetch the file spend tokens on your contract and auth docs
        instead of navigation chrome. Keep it honest: stale links train
        everything that reads them to ignore the map.
      </p>

      <h2 id="spec-shape">Spec shape</h2>
      <p>The informal spec at llmstxt.org is Markdown with a fixed skeleton:</p>
      <ol>
        <li>
          <strong>H1</strong> with the project or site name (required).
        </li>
        <li>
          Optional <strong>blockquote</strong> summary that grounds the rest of
          the file.
        </li>
        <li>
          Optional free-form paragraphs (not headings) with more background.
        </li>
        <li>
          Zero or more <strong>H2</strong> sections. Each is a list of{" "}
          <code>- [title](url): optional note</code> entries.
        </li>
        <li>
          By convention an H2 named <strong>Optional</strong> for secondary
          links an agent can skip when it needs a shorter context. In v1 this
          heading was machine-readable: it told the context-expansion tool which
          links to omit. v2 dropped that tool, so <code>Optional</code> is now a
          hint to the reader rather than an instruction to a parser. It is still
          worth using, and still belongs last.
        </li>
      </ol>
      <CodeBlock language="markdown" code={EXAMPLE} />
      <p>
        Prefer linking to Markdown when you have it. Put blog posts and
        historical material under <code>Optional</code>. Curate aggressively: a
        thousand-link index recreates the context-window problem the file exists
        to solve.
      </p>

      <h2 id="v2">What changed in v2</h2>
      <p>
        v1 told you what to put <em>in</em> the file but left the surrounding
        questions open. The spec now poses the one that mattered most: given a
        page, how does an agent find its markdown version, or the llms.txt file
        that covers it, without guessing? Five changes answer it.
      </p>
      <ol>
        <li>
          <strong>Link relations for discovery.</strong> The headline change.{" "}
          <code>rel=&quot;alternate&quot; type=&quot;text/markdown&quot;</code>{" "}
          points from a page to its markdown version, and{" "}
          <code>rel=&quot;describedby&quot;</code> points to the llms.txt file
          covering it. Both can be HTML <code>&lt;link&gt;</code> elements or an
          HTTP <code>Link:</code> response header.
        </li>
        <li>
          <strong>Two markdown URL forms.</strong> v1 allowed only{" "}
          <code>.md</code> appended to the full page URL (
          <code>page.html.md</code>). Many publishing tools replace the
          extension instead (<code>page.md</code>), so v2 permits both. URLs
          without a file name append <code>index.html.md</code> or{" "}
          <code>index.md</code>.
        </li>
        <li>
          <strong>Subpath coverage is defined.</strong> v1 permitted files at
          subpaths without saying what they meant. v2 states it: a file covers
          the pages under its path, and where several apply the most specific
          one wins. So <code>/docs/llms.txt</code> covers everything in{" "}
          <code>/docs/</code>. This is what lets a project that controls only a
          path, such as a GitHub Pages site, participate properly.
        </li>
        <li>
          <strong>The consumption model is stated.</strong> v1 said nothing
          about how the file should be read and shipped an{" "}
          <code>llms_txt2ctx</code> tool that expanded it into one large
          context. v2 drops the tool and states the expectation instead: agents
          view or search the llms.txt, then follow the links they need. The file
          stays small; the detail lives behind the links.
        </li>
        <li>
          <strong>
            <code>Optional</code> lost its mechanical meaning.
          </strong>{" "}
          It existed to tell the expansion tool what to leave out. With the tool
          gone, the section remains a useful convention and nothing more.
        </li>
      </ol>
      <p>
        Nothing here invalidates an existing file. If you already publish a v1
        llms.txt, adding the two link relations is the whole upgrade.
      </p>

      <h2 id="link-relations">Link relations</h2>
      <p>
        The header form is usually the better one to reach for. It works on
        non-HTML resources, including the markdown files themselves, and can be
        added in web-server or CDN configuration without touching a single
        template:
      </p>
      <CodeBlock language="http" code={LINK_HEADER} />
      <p>
        The equivalent in a page&apos;s <code>&lt;head&gt;</code>:
      </p>
      <CodeBlock language="html" code={LINK_ELEMENTS} />
      <p>
        Relative URLs are fine in both forms. Point{" "}
        <code>rel=&quot;describedby&quot;</code> at the most specific llms.txt
        that covers the page, not always the one at the site root.
      </p>

      <h2 id="daloyjs-dev">How daloyjs.dev implements it</h2>
      <p>
        The site route <code>website/app/llms.txt/route.ts</code> builds the
        file at request time (cached for an hour):
      </p>
      <ul>
        <li>
          Project links (homepage, docs <Link href="/docs/mcp">MCP server</Link>
          , GitHub, npm, JSR, <code>create-daloy</code>).
        </li>
        <li>
          Every docs page from <code>getDocsSearchSections()</code>, grouped
          like the sidebar, with URLs pointing at the <code>.md</code> siblings.
        </li>
        <li>
          Blog posts under the final <code>## Optional</code> section.
        </li>
      </ul>
      <p>
        Two more surfaces implement the v2 half. There is a second, narrower
        index at{" "}
        <a href="https://daloyjs.dev/docs/llms.txt" rel="noopener noreferrer">
          /docs/llms.txt
        </a>{" "}
        covering just the documentation, built from the same{" "}
        <code>getDocsSearchSections()</code> call. And{" "}
        <code>website/proxy.ts</code> stamps the <code>Link:</code> header onto
        every response, so a docs page advertises its <code>.md</code> sibling
        and points at <code>/docs/llms.txt</code>, while the rest of the site
        points at the root <code>/llms.txt</code>. The matching{" "}
        <code>&lt;link rel=&quot;alternate&quot;&gt;</code> element comes from{" "}
        <code>buildMetadata()</code> in <code>website/lib/seo.ts</code>, so
        every docs page gets it without per-page wiring.
      </p>
      <p>
        Agents that prefer structured tools over page fetches can use{" "}
        <code>https://daloyjs.dev/mcp</code> (
        <Link href="/docs/mcp">MCP docs</Link>) with <code>search_docs</code>,{" "}
        <code>get_doc</code>, and <code>list_docs</code>. The{" "}
        <code>llms.txt</code> file points at that endpoint so the two surfaces
        stay discoverable together.
      </p>

      <h2 id="for-your-api">For your own API or docs site</h2>
      <p>
        <code>@daloyjs/core</code> does not force every API process to serve{" "}
        <code>/llms.txt</code>. That file belongs on the host that publishes
        human documentation (marketing site, docs portal, or static docs
        deploy). For a DaloyJS API you still give agents a short list of
        canonical machine surfaces:
      </p>
      <ul>
        <li>
          OpenAPI from your app (see{" "}
          <Link href="/docs/openapi">OpenAPI generation</Link>).
        </li>
        <li>
          Validated route examples via{" "}
          <Link href="/docs/ai-metadata">AI-friendly route metadata</Link> and{" "}
          <code>daloy inspect --ai</code>.
        </li>
        <li>
          Optional dedicated <Link href="/docs/mcp">MCP server</Link> for live
          tools.
        </li>
        <li>
          In-repo <code>AGENTS.md</code> for agents that edit the codebase (the
          scaffolder ships one; see the scaffolder docs).
        </li>
      </ul>
      <p>
        If you publish a docs site, add <code>/llms.txt</code> there, keep{" "}
        <code>.md</code> siblings if you can, and regenerate the index from the
        same source of truth as your human nav so the map cannot rot alone.
      </p>

      <h2 id="checklist">Checklist</h2>
      <ul>
        <li>
          File is reachable at <code>https://&lt;host&gt;/llms.txt</code> with{" "}
          <code>text/plain</code> (or Markdown) and a 2xx status.
        </li>
        <li>H1 + short summary describe the product in plain language.</li>
        <li>
          Links are curated, described, and mostly point at Markdown or other
          low-chrome content.
        </li>
        <li>
          <code>## Optional</code> is last when you include secondary material
          (a convention now, not a parser directive).
        </li>
        <li>
          Pages advertise their markdown sibling with{" "}
          <code>rel=&quot;alternate&quot; type=&quot;text/markdown&quot;</code>{" "}
          and their index with <code>rel=&quot;describedby&quot;</code>, as a{" "}
          <code>Link:</code> header, <code>&lt;link&gt;</code> elements, or
          both.
        </li>
        <li>
          A file at a subpath covers the pages beneath it. If you publish{" "}
          <code>/docs/llms.txt</code>, point the docs pages&apos;{" "}
          <code>describedby</code> at it rather than at the root file.
        </li>
        <li>
          <code>robots.txt</code> still allows the bots you intend to read docs;
          blocking them makes the map unread.
        </li>
        <li>
          Review the file when you add or remove docs routes (same cadence as
          nav updates).
        </li>
      </ul>
    </>
  );
}
