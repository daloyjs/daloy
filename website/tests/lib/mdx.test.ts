import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";

import { extractMdxBodyText, parseMdxSource } from "../../lib/mdx/content";
import remarkDaloy, { parseCodeMeta } from "../../lib/mdx/remark-daloy";
import { Converter } from "../../scripts/tsx-to-mdx";

async function compiled(mdx: string): Promise<string> {
  return String(await compile(mdx, { remarkPlugins: [remarkGfm, remarkDaloy] }));
}

test("parseCodeMeta reads title, highlight spec and flags", () => {
  const meta = parseCodeMeta('title="src/app.ts" {1,3-4} lineNumbers dev');
  assert.equal(meta.title, "src/app.ts");
  assert.equal(meta.highlight, "1,3-4");
  assert.equal(meta.lineNumbers, true);
  assert.ok(meta.flags.has("dev"));
  assert.deepEqual(parseCodeMeta(undefined), { lineNumbers: false, flags: new Set() });
});

test("code fences become CodeBlock / PackageInstall elements", async () => {
  const js = await compiled('```ts title="a.ts" {2}\nconst a = 1;\n```\n\n```package-install dev\ntsx  typescript\n```');
  assert.match(js, /_components\.CodeBlock|CodeBlock,/);
  assert.match(js, /title: "a\.ts"/);
  assert.match(js, /highlight: "2"/);
  assert.match(js, /packages: "tsx typescript"/);
  assert.match(js, /dev: true/);
});

test("headings get slugs, custom [#id] markers, and de-duplicated ids", async () => {
  const js = await compiled("## Hello `world`\n\n## Install it [#install]\n\n## Hello world\n");
  assert.match(js, /id: "hello-world"/);
  assert.match(js, /id: "install"/);
  assert.match(js, /id: "hello-world-1"/);
  // The marker never reaches the rendered text.
  assert.doesNotMatch(js, /\[#install\]/);
});

test("parseMdxSource validates frontmatter and keeps line numbers", () => {
  const { frontmatter, body } = parseMdxSource("---\ntitle: T\ndescription: D\n---\n# Body\n", "x.mdx");
  assert.deepEqual(frontmatter, { title: "T", description: "D", keywords: [] });
  assert.equal(body, "\n\n\n\n# Body\n");
});

test("parseMdxSource rejects missing, unknown and empty frontmatter fields", () => {
  assert.throws(() => parseMdxSource("# no frontmatter", "a.mdx"), /a\.mdx: missing YAML frontmatter/);
  assert.throws(() => parseMdxSource("---\ntitle: T\ndescripton: typo\n---\n", "b.mdx"), /b\.mdx: invalid frontmatter/);
  assert.throws(() => parseMdxSource("---\ntitle: ''\ndescription: D\n---\n", "c.mdx"), /invalid frontmatter/);
});

test("extractMdxBodyText keeps prose and code, drops JSX and markers", () => {
  const text = extractMdxBodyText('export const X = 1;\n\n## Intro [#intro]\n\nRead **[the docs](/docs)**.\n\n<FlowDiagram steps={[]} />\n\n```ts\napp.get("/")\n```');
  assert.equal(text, 'Intro Read the docs . app.get("/")');
});

function convert(body: string, extra = ""): string {
  const source = `import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";
${extra}
export const metadata = buildMetadata({ title: "T", description: "D", path: "/docs/x/y", keywords: ["k"], type: "article" });
export default function Page() {
  return (
    <>
${body}
    </>
  );
}`;
  return new Converter(source, "page.tsx").convert().mdx;
}

test("converter turns prose, inline markup, lists, tables and code into markdown", () => {
  const mdx = convert(`
      <h1>Title</h1>
      <h2 id="custom-anchor">Real heading</h2>
      <h2 id="plain">Plain</h2>
      <p>
        Use <code>app.get()</code> with <strong>care</strong>, see{" "}
        <Link href={"/docs/routing" as Route}>routing</Link> and 5 * 3 {"{braces}"}.
      </p>
      <ul>
        <li>one</li>
        <li><em>two</em></li>
      </ul>
      <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1 | 2</td><td><code>x</code></td></tr></tbody></table>
      <CodeBlock language="bash" code={CMD} />`, 'const CMD = `pnpm add x`;\nimport Link from "next/link";\nimport type { Route } from "next";');
  assert.match(mdx, /^---\ntitle: T\ndescription: D\nkeywords:\n  - k\n---\n/);
  assert.match(mdx, /^# Title$/m);
  assert.match(mdx, /^## Real heading \[#custom-anchor\]$/m);
  assert.match(mdx, /^## Plain$/m);
  assert.match(mdx, /Use `app\.get\(\)` with \*\*care\*\*, see \[routing\]\(\/docs\/routing\) and 5 \\\* 3 \\\{braces\\\}\./);
  assert.match(mdx, /^- one\n- \*two\*$/m);
  assert.match(mdx, /^\| A \| B \|\n\| --- \| --- \|\n\| 1 \\\| 2 \| `x` \|$/m);
  assert.match(mdx, /^```bash\npnpm add x\n```$/m);
});

test("converter keeps unknown JSX verbatim, strips TS, and exports referenced consts", () => {
  const mdx = convert(`
      <div className="box">
        <Link href={"/docs/a" as Route}>a</Link>
      </div>
      <FlowDiagram steps={STEPS} />`, 'import { FlowDiagram } from "@/components/diagram";\nimport Link from "next/link";\nimport type { Route } from "next";\nconst STEPS: string[] = ["a"];');
  assert.match(mdx, /^export const STEPS = \["a"\];$/m);
  // Inline content inside raw JSX stays on one line (JSX whitespace rules).
  assert.match(mdx, /<div className="box"><Link href=\{"\/docs\/a"\}>a<\/Link><\/div>/);
  assert.match(mdx, /<FlowDiagram steps=\{STEPS\} \/>/);
});

test("raw JSX keeps JSX whitespace semantics under MDX (no stray spaces, no <p> wrappers)", async () => {
  const mdx = convert(`
      <div role="note">
        <p>
          Call <code>app.registerRoutes([...])</code>
          {". "}Then 2 * 3 is _six_.
        </p>
        <p className="x">second</p>
      </div>`);
  // Structural children stay on their own lines...
  assert.match(mdx, /^<div role="note">\n<p>/m);
  // ...inline runs collapse exactly like JSX: no space before the period.
  assert.match(mdx, /<p>Call <code>app\.registerRoutes\(\\\[\.\.\.\\\]\)<\/code>\{"\. "\}Then 2 \\\* 3 is \\_six\\_\.<\/p>/);
  // And MDX renders it without adding paragraphs inside the <p>.
  const js = String(await compile(mdx.replace(/^---[\s\S]*?---\n/, ""), { remarkPlugins: [remarkGfm] }));
  assert.doesNotMatch(js, /_components\.p, \{\s*children: \[\s*"Call/);
});

test("multi-line opening tags inside inline runs are flattened so MDX cannot read them as blockquotes", async () => {
  const mdx = convert(`
      <div className="grid">
        <Link
          href="/docs/a"
          className="card"
        >
          <span>A</span> first
        </Link>
      </div>`, 'import Link from "next/link";');
  assert.match(mdx, /<Link href="\/docs\/a" className="card"><span>A<\/span> first<\/Link>/);
  await compile(mdx.replace(/^---[\s\S]*?---\n/, ""), { remarkPlugins: [remarkGfm] });
});

test("blockquotes with bare inline content stay JSX; ones with paragraphs become markdown", () => {
  const inline = convert(`
      <blockquote>
        Fail fast, see <code>defineConfig()</code>.
      </blockquote>`);
  assert.match(inline, /^<blockquote>Fail fast, see <code>defineConfig\(\)<\/code>\.<\/blockquote>$/m);
  const blocks = convert(`
      <blockquote>
        <p>First.</p>
        <p>Second.</p>
      </blockquote>`);
  assert.match(blocks, /^> First\.\n>\n> Second\.$/m);
});

test("regressions found by the full-migration DOM diff", async () => {
  // Non-breaking spaces survive inline code.
  assert.match(convert("<p>dynamic <code>IN&nbsp;(...)</code> arities</p>"), /`IN\u00a0\(\.\.\.\)`/);

  // Bare URLs / emails stay plain text (no GFM autolink).
  const plain = convert("<p>Open https://dashboard.example.com or www.example.com, or mail ops@example.com.</p>");
  const plainJs = String(await compile(plain.replace(/^---[\s\S]*?---\n/, ""), { remarkPlugins: [remarkGfm] }));
  assert.doesNotMatch(plainJs, /_components\.a\b/);

  // A table row carrying an anchor id keeps it (table stays JSX).
  const table = convert("<table><thead><tr><th>A</th></tr></thead><tbody><tr id=\"api3\"><td>x</td></tr></tbody></table>");
  assert.match(table, /<tr id="api3">/);

  // A list item mixing text with a block child is kept as JSX (no loose-list <p>).
  const list = convert("<ul><li>Text first:<CodeBlock language=\"bash\" code={`a\n  b`} /></li></ul>");
  assert.match(list, /^<ul>\n<li>Text first:<CodeBlock/m);

  // Repeated headings: explicit ids and generated slugs line up with remark-daloy.
  const headings = convert(`
      <h3 id="why">Why</h3>
      <h3 id="why-2">Why</h3>
      <h3 id="why-3">Why</h3>`);
  const js = String(await compile(headings.replace(/^---[\s\S]*?---\n/, ""), { remarkPlugins: [remarkGfm, remarkDaloy] }));
  for (const id of ["why", "why-2", "why-3"]) assert.match(js, new RegExp(`id: "${id}"`));

  // Multi-line code inside nested JSX keeps its exact value (and indentation),
  // emitted as a one-line string so MDX cannot split it.
  const nested = convert("<div className=\"x\"><div className=\"y\"><CodeBlock code={`a\n    indented`} /></div></div>");
  assert.match(nested, /code=\{"a\\n    indented"\}/);
  const pre = convert("<div className=\"x\"><pre><code>{`line\n   ├─ indented`}</code></pre></div>");
  assert.match(pre, /<code>\{"line\\n   ├─ indented"\}<\/code>/);
  // Bare URLs in text become string expressions: same characters, no link, no backslash.
  assert.match(convert("<p>see https://x.example/a_b.</p>"), /see \{"https:\/\/x\.example\/a_b"\}\./);
  const inList = convert("<ul><li>Pin it:<CodeBlock code={`import x from \"y\";\n- not a list\n# not a heading\n}`} /></li></ul>");
  await compile(inList.replace(/^---[\s\S]*?---\n/, ""), { remarkPlugins: [remarkGfm] });
});

test("converter decodes every named HTML entity, not just a short list", () => {
  const mdx = convert(`
      <p>It&rsquo;s &ldquo;quoted&rdquo; &hellip; &rarr; &check; &amp; done</p>`);
  assert.match(mdx, /It’s “quoted” … → ✓ & done/);
  assert.doesNotMatch(mdx, /&rsquo;|&ldquo;/);
});

test("converter refuses pages with components MDX cannot provide", () => {
  assert.throws(
    () => convert("<Widget />", 'import { Widget } from "@/components/widget";'),
    /imports Widget/,
  );
  // A component that is used but never imported is refused too.
  assert.throws(() => convert("<div><Widget /></div>"), /<Widget> is not provided/);
  assert.doesNotThrow(() => convert("<p>x</p>"));
});
