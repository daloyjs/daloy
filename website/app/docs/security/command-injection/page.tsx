import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Command injection",
  description:
    "How DaloyJS keeps the framework itself free of shell-out primitives, and the safe patterns (and grep rules) you should use when your own handlers need to invoke an external program.",
  path: "/docs/security/command-injection",
  keywords: [
    "DaloyJS command injection",
    "Node.js command injection",
    "child_process exec safe",
    "execFile vs exec",
    "BatBadBut",
    "CVE-2024-27980",
    "shell injection Node",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Command injection</h1>
      <blockquote>
        <strong>Think of it like…</strong> the difference between handing a
        kitchen a printed order ticket with separate fields (&quot;dish:
        omelette, eggs: 2&quot;) versus shouting an order through a megaphone
        the cook reads literally. With the ticket (<code>execFile</code> + argv
        array), &quot;burn down the restaurant&quot; ends up in the
        &quot;dish&quot; field, meaningless. With the megaphone (
        <code>exec(`cmd ${"${input}"}`)</code>), a stray semicolon turns one
        order into two, and the second one is whatever the attacker wanted.
      </blockquote>
      <p>
        Aikido&apos;s{" "}
        <a
          href="https://www.aikido.dev/blog/command-injection-in-2024-unpacked"
          target="_blank"
          rel="noreferrer"
        >
          Command injection in 2024 unpacked
        </a>{" "}
        report is a good reminder that &ldquo;just shell out for this one
        thing&rdquo; remains a top source of RCE in Node services. The pattern
        is always the same: untrusted input ends up inside a string that gets
        handed to <code>/bin/sh -c</code> (or <code>cmd.exe /c</code> on
        Windows), and a metacharacter like <code>;</code>, <code>|</code>,{" "}
        <code>$()</code>, or a stray <code>&amp;</code> turns one command into
        many.
      </p>
      <p>
        DaloyJS is an HTTP framework, not a shell, so the framework itself
        can&apos;t generally interpolate attacker input into a child process on
        your behalf. What it <em>can</em> do is (1) keep its own runtime free of
        the primitives that get abused, and (2) document the safe pattern so the
        handlers you write don&apos;t reintroduce the bug.
      </p>

      <h2>What Daloy already does for you</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>What it blocks</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Zero <code>child_process</code> in <code>src/**</code>
            </td>
            <td>
              A CI gate (
              <a
                href="https://github.com/daloyjs/daloy/blob/main/scripts/verify-no-remote-exec.ts"
                target="_blank"
                rel="noreferrer"
              >
                <code>verify-no-remote-exec.ts</code>
              </a>
              ) refuses to merge any PR that imports{" "}
              <code>node:child_process</code>, <code>node:vm</code>,{" "}
              <code>eval</code>, <code>new Function</code>, or a remote dynamic{" "}
              <code>import()</code> inside the runtime source. The framework
              cannot accidentally shell out, and a compromised maintainer cannot
              quietly add an <code>exec(&apos;curl ... | sh&apos;)</code> at
              import time.
            </td>
          </tr>
          <tr>
            <td>Strict per-route schemas (Zod)</td>
            <td>
              Every route declares <code>params</code>, <code>query</code>, and{" "}
              <code>body</code> shapes. If you constrain a field with{" "}
              <code>z.enum([...])</code>, a tight regex, or{" "}
              <code>z.string().uuid()</code>, attacker shell metacharacters
              don&apos;t reach your handler in the first place &mdash; the
              request is rejected with <strong>400 problem+json</strong>.
            </td>
          </tr>
          <tr>
            <td>Body-size cap (1&nbsp;MiB default)</td>
            <td>
              Stops the &ldquo;DoS-amplified injection&rdquo; pattern where the
              attacker uploads a multi-MB payload of shell glue hoping something
              on the server pipes it into a process.
            </td>
          </tr>
          <tr>
            <td>
              CLI <code>spawn</code> uses fixed argv
            </td>
            <td>
              When you run <code>daloy dev</code>, the framework spawns{" "}
              <code>node</code> / <code>bun</code> / <code>deno</code> with a
              hardcoded argv built by <code>buildDevCommand()</code> &mdash;
              never a shell string. The <code>create-daloy</code> scaffolder
              does the same for <code>git init</code> and{" "}
              <code>&lt;pm&gt; install</code>: the command and arguments are
              constants; only the working directory is derived from input, and{" "}
              <code>cwd</code> is not shell-parsed.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        None of that <em>prevents your handler from shelling out unsafely</em>.
        That is on you. The rest of this page is the pattern to follow when you
        do need to invoke an external program from a Daloy route.
      </p>

      <h2>
        The safe shape: <code>execFile</code> / <code>spawn</code>, no shell
      </h2>
      <p>
        Two rules cover ~95% of the real-world Node CVEs in the Aikido write-up:
      </p>
      <FlowDiagram
        title="Where the second command comes from"
        steps={[
          {
            eyebrow: "ingress",
            label: "User input",
            detail: 'sourcePath = "x.mp4; rm -rf /"',
          },
          {
            eyebrow: "shell string",
            label: "exec(`cmd ${input}`)",
            detail: "/bin/sh -c parses ; | $() &",
            tone: "danger",
          },
          {
            eyebrow: "argv array",
            label: "execFile + [args]",
            detail: "shell: false, one literal arg",
            tone: "success",
          },
        ]}
        caption="A shell string lets a stray metacharacter turn one command into many. An argv array with no shell passes the whole value as a single literal argument, so the metacharacters are inert."
      />
      <ol>
        <li>
          Use <code>execFile</code> or <code>spawn</code> with an{" "}
          <em>array of arguments</em>. Never{" "}
          <code>{"exec(`cmd ${userInput}`)"}</code> with a template string.
        </li>
        <li>
          Leave <code>shell: false</code> (the default). If you set{" "}
          <code>shell: true</code>, every argument becomes shell-parsable and
          you have to escape metacharacters yourself &mdash; which is exactly
          the bug class you&apos;re trying to avoid.
        </li>
      </ol>
      <CodeBlock
        code={`import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { App, z } from "@daloyjs/core";

const execFileAsync = promisify(execFile);
const app = new App();

const ConvertBody = z.object({
  // 1) Constrain the input at the HTTP boundary. An enum, a tight regex, or
  //    a UUID is almost always enough - shell metacharacters can't survive
  //    a Zod schema that doesn't allow them.
  format: z.enum(["png", "jpeg", "webp"]),
  sourcePath: z
    .string()
    .regex(/^[a-zA-Z0-9_\\-./]+$/, "path may only contain [A-Za-z0-9_-./]")
    .max(256),
});

app.route({
  method: "POST",
  path: "/convert",
  operationId: "convert",
  body: ConvertBody,
  responses: { 200: { description: "ok" } },
  handler: async ({ body }) => {
    // 2) execFile with an argv array - no shell, no interpolation.
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-i", body.sourcePath, "-f", body.format, "pipe:1"],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }
    );
    return { status: 200 as const, body: { bytes: stdout.length } };
  },
});`}
      />
      <p>
        Even if <code>body.sourcePath</code> were{" "}
        <code>{`"foo.mp4; rm -rf /"`}</code>, the regex would reject it at the
        boundary; if you removed the regex, <code>execFile</code> would still
        pass the whole string as a single argv element to <code>ffmpeg</code>,
        which would simply fail to open a file by that name. No shell ever runs.
      </p>

      <h2>Anti-patterns to grep for</h2>
      <p>
        These are the patterns the Aikido write-up keeps finding in compromised
        packages. Wire them into a CI grep (or Semgrep / CodeQL) on your own
        repo and you&apos;ll catch most new command-injection bugs at PR time:
      </p>
      <CodeBlock
        language="bash"
        code={`# 1. exec / execSync / spawnSync with a template literal or string concat.
git grep -nE 'exec(Sync)?\\(\\s*[\\\`"][^\\\`"]*\\$\\{' -- '*.ts' '*.tsx' '*.js' '*.mjs'
git grep -nE 'exec(Sync)?\\(\\s*[^,]+\\+' -- '*.ts' '*.tsx' '*.js' '*.mjs'

# 2. spawn / spawnSync with shell: true.
git grep -nE 'spawn(Sync)?\\([^)]*shell:\\s*true' -- '*.ts' '*.tsx' '*.js' '*.mjs'

# 3. Direct shell helpers that always go through /bin/sh.
git grep -nE '\\\\bshelljs\\\\b|\\\\bexeca\\\\b\\\\(.*shell:\\\\s*true' -- '*.ts' '*.tsx' '*.js' '*.mjs'

# 4. The 'just one line of bash' temptation.
git grep -nE 'require\\(["'\\\\'']child_process["'\\\\'']\\)|from\\s+["'\\\\'']node:child_process["'\\\\'']' -- '*.ts' '*.tsx' '*.js' '*.mjs'`}
      />
      <p>
        If you want to lock the framework-level guarantee into your own app,
        copy{" "}
        <a
          href="https://github.com/daloyjs/daloy/blob/main/scripts/verify-no-remote-exec.ts"
          target="_blank"
          rel="noreferrer"
        >
          <code>scripts/verify-no-remote-exec.ts</code>
        </a>{" "}
        and run it from <code>pnpm test</code>. It refuses any import of{" "}
        <code>child_process</code> / <code>vm</code>, any bare <code>eval</code>
        , <code>new Function</code>, or remote dynamic <code>import()</code>. If
        a handler genuinely needs to shell out, scope the allow-list to that one
        file rather than turning the gate off for the whole repo.
      </p>

      <h2>Windows footgun: BatBadBut (CVE-2024-27980)</h2>
      <p>
        Node.js 21.7.2+ ships the fix for{" "}
        <a
          href="https://nvd.nist.gov/vuln/detail/CVE-2024-27980"
          target="_blank"
          rel="noreferrer"
        >
          CVE-2024-27980
        </a>{" "}
        (&ldquo;BatBadBut&rdquo;): on Windows, launching a <code>.bat</code> /{" "}
        <code>.cmd</code> file through <code>spawn</code> without{" "}
        <code>shell: true</code> used to be vulnerable to argv-to-cmd-line
        re-quoting injection. If you target older Node versions, either{" "}
        <strong>upgrade Node</strong>, or set <code>shell: true</code> and
        validate every argument against a strict allow-list before you spawn.
        Daloy&apos;s engines field already requires a fixed Node version, so you
        inherit the patched runtime by default &mdash; but you&apos;re still
        responsible for argument validation if you opt into{" "}
        <code>shell: true</code>.
      </p>

      <h2>When you really do need a shell</h2>
      <p>
        Sometimes you genuinely need pipes, globs, or output redirection. The
        safe pattern is to write the script as a real file on disk (or check it
        in) and spawn it as an argument-only invocation:
      </p>
      <CodeBlock
        code={`// Instead of: exec(\`bash -c "tar -czf - \${dir} | aws s3 cp - s3://bucket/\${key}"\`)
//
// Check in a script that takes the variable parts as positional arguments,
// validates them itself, and shell-quotes them with printf %q. Then call:
await execFileAsync("/usr/local/bin/upload-backup.sh", [
  validatedDir,    // already matched against /^[a-zA-Z0-9_/-]+$/
  validatedKey,    // already matched against /^[a-zA-Z0-9_/-]+\\.tar\\.gz$/
], { timeout: 60_000 });`}
      />
      <p>
        The script lives in your repo, gets code-reviewed, and only the
        validated values cross the process boundary. The Node side never has to
        build a shell string.
      </p>

      <h2>Defense in depth</h2>
      <ul>
        <li>
          <strong>Drop privileges.</strong> Run the Node process as a non-root
          user and constrain it with{" "}
          <a
            href="https://kubernetes.io/docs/concepts/security/pod-security-standards/"
            target="_blank"
            rel="noreferrer"
          >
            seccomp / Kubernetes Pod Security
          </a>{" "}
          or a Docker <code>USER</code> directive. Even a successful command
          injection then runs as an unprivileged user with no write access
          outside <code>/tmp</code>.
        </li>
        <li>
          <strong>Audit your runtime dependencies.</strong> Most real-world
          command-injection CVEs in 2024 were not in application code &mdash;
          they were in transitive npm packages that wrapped{" "}
          <code>child_process.exec()</code>. Use <code>pnpm audit</code> on a
          schedule, and prefer the supply-chain hardened install path documented
          in <a href="/docs/security/supply-chain">Supply-chain security</a>.
        </li>
        <li>
          <strong>Reach for a library when possible.</strong> <code>sharp</code>{" "}
          for image processing, <code>archiver</code> for zip files,{" "}
          <code>node:fs/promises</code> for copies &mdash; an in-process Node
          library never invokes a shell, so the entire bug class disappears.
        </li>
      </ul>

      <h2>Reporting</h2>
      <p>
        Found a command-injection-shaped weakness in Daloy itself (e.g. a CLI or
        scaffolder that interpolates user input into a spawn call, or a
        documented example that demonstrates an unsafe pattern)? Report it
        privately via{" "}
        <a
          href="https://github.com/daloyjs/daloy/security/advisories/new"
          target="_blank"
          rel="noreferrer"
        >
          github.com/daloyjs/daloy/security/advisories/new
        </a>
        . Don&apos;t open a public issue.
      </p>
    </>
  );
}
