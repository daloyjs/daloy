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
  assert.match(mdx, /<div className="box">\n  <Link href=\{"\/docs\/a"\}>a<\/Link>\n<\/div>/);
  assert.match(mdx, /<FlowDiagram steps=\{STEPS\} \/>/);
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
