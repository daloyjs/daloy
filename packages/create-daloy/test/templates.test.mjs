import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

async function runCreateDaloy(args, opts = {}) {
  return await new Promise((resolve) => {
    let output = "";
    const proc = spawn(process.execPath, [path.join(pkgRoot, "bin/create-daloy.mjs"), ...args], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (chunk) => (output += chunk.toString()));
    proc.stderr.on("data", (chunk) => (output += chunk.toString()));
    proc.on("exit", (code) => resolve({ exitCode: code ?? 1, output }));
    proc.on("error", () => resolve({ exitCode: 1, output }));
  });
}

test("choiceInputMode prefers the controlling TTY when a wrapper hides raw mode on POSIX", async () => {
  process.env.DALOY_TEST_IMPORT = "1";
  let choiceInputMode;
  try {
    ({ choiceInputMode } = await import(
      `file://${path.join(pkgRoot, "bin/create-daloy.mjs")}?test=${Date.now()}`
    ));
  } finally {
    delete process.env.DALOY_TEST_IMPORT;
  }

  assert.equal(
    choiceInputMode({ stdinIsTTY: true, hasRawMode: true, platform: "darwin" }),
    "stdin",
  );
  assert.equal(
    choiceInputMode({
      stdinIsTTY: true,
      hasRawMode: false,
      platform: "darwin",
    }),
    "tty",
  );
  assert.equal(
    choiceInputMode({ stdinIsTTY: true, hasRawMode: false, platform: "linux" }),
    "tty",
  );
  assert.equal(
    choiceInputMode({ stdinIsTTY: true, hasRawMode: false, platform: "win32" }),
    "numbered",
  );
  assert.equal(
    choiceInputMode({
      stdinIsTTY: false,
      hasRawMode: false,
      platform: "linux",
    }),
    "tty",
  );
});

test("node-basic health route preserves literal true type", async () => {
  const source = await readFile(
    path.join(pkgRoot, "templates/node-basic/src/build-app.ts"),
    "utf8",
  );
  assert.match(
    source,
    /body:\s*\{ ok: true as const, uptime: process\.uptime\(\) \}/,
  );
});

test("vercel-edge health route preserves literal true type", async () => {
  const source = await readFile(
    path.join(pkgRoot, "templates/vercel-edge/api/[...path].ts"),
    "utf8",
  );
  assert.match(
    source,
    /body:\s*\{ ok: true as const, runtime: "vercel-edge" as const \}/,
  );
});

test("node-basic template opts into the auto-mounted /docs and /openapi.json", async () => {
  const source = await readFile(
    path.join(pkgRoot, "templates/node-basic/src/build-app.ts"),
    "utf8",
  );
  // The framework auto-mounts /docs and /openapi.json when `docs: true` is
  // set on the App constructor. info.title / info.version are auto-filled
  // from package.json so the template no longer hardcodes them.
  assert.match(source, /docs:\s*true/);
  assert.match(source, /openapi:\s*\{/);
  assert.doesNotMatch(source, /info:\s*\{\s*title:\s*"My Daloy API"/);
});

test("node-basic separates buildApp() from server boot so codegen has no side effects", async () => {
  const buildApp = await readFile(
    path.join(pkgRoot, "templates/node-basic/src/build-app.ts"),
    "utf8",
  );
  // Factory must be exported and must NOT import the serve() entrypoint —
  // importing `@daloyjs/core/node` here would let codegen accidentally pull
  // in the Node http server and start a listener.
  assert.match(buildApp, /export\s+function\s+buildApp\s*\(/);
  assert.doesNotMatch(buildApp, /from\s+"@daloyjs\/core\/node"/);

  const indexFile = await readFile(
    path.join(pkgRoot, "templates/node-basic/src/index.ts"),
    "utf8",
  );
  assert.match(indexFile, /from\s+"\.\/build-app\.js"/);
  assert.match(indexFile, /\bserve\s*\(\s*app\b/);

  const dump = await readFile(
    path.join(pkgRoot, "templates/node-basic/scripts/dump-openapi.ts"),
    "utf8",
  );
  // dump-openapi must use the factory, not import the server entrypoint
  // (that would boot the HTTP listener as a side effect of codegen).
  assert.match(dump, /from\s+"\.\.\/src\/build-app\.js"/);
  assert.doesNotMatch(dump, /from\s+"\.\.\/src\/index\.js"/);

  const tsconfig = JSON.parse(
    await readFile(
      path.join(pkgRoot, "templates/node-basic/tsconfig.json"),
      "utf8",
    ),
  );
  const buildTsconfig = JSON.parse(
    await readFile(
      path.join(pkgRoot, "templates/node-basic/tsconfig.build.json"),
      "utf8",
    ),
  );
  const pkg = JSON.parse(
    await readFile(
      path.join(pkgRoot, "templates/node-basic/package.json"),
      "utf8",
    ),
  );
  // The OpenAPI dump script lives under `scripts/`; keep it inside the
  // project's tsconfig so editors load the Node type context for
  // `node:fs/promises` and `process`. Keep tests in the editor/typecheck
  // project too so scaffolded test files also get the Node globals.
  assert.deepEqual(tsconfig.include, [
    "src/**/*",
    "scripts/**/*",
    "tests/**/*",
  ]);
  // Once scripts/tests are part of the program, `rootDir` must widen beyond
  // `src` so TypeScript does not fail with TS6059.
  assert.equal(tsconfig.compilerOptions.rootDir, ".");
  // Build output should still exclude tests, so the template uses a dedicated
  // build tsconfig for `pnpm build`.
  assert.equal(pkg.scripts.build, "tsc -p tsconfig.build.json");
  assert.equal(buildTsconfig.extends, "./tsconfig.json");
  assert.deepEqual(buildTsconfig.include, ["src/**/*", "scripts/**/*"]);
  assert.deepEqual(buildTsconfig.exclude, ["node_modules", "dist", "tests"]);
});

test("vercel-edge template opts into the auto-mounted /docs and /openapi.json", async () => {
  const source = await readFile(
    path.join(pkgRoot, "templates/vercel-edge/api/[...path].ts"),
    "utf8",
  );
  assert.match(source, /docs:\s*true/);
  assert.match(source, /openapi:\s*\{/);
  assert.match(source, /info:\s*\{\s*title:\s*"My Daloy Edge API"/);
});

test("every template ships a hardened _Dockerfile and _dockerignore", async () => {
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
    "deno-basic",
  ];

  for (const template of templates) {
    const dockerfile = await readFile(
      path.join(pkgRoot, "templates", template, "_Dockerfile"),
      "utf8",
    );
    const dockerignore = await readFile(
      path.join(pkgRoot, "templates", template, "_dockerignore"),
      "utf8",
    );

    // BuildKit syntax pin enables reproducible, modern builder features.
    assert.match(
      dockerfile,
      /^#\s*syntax=docker\/dockerfile:/m,
      `${template} Dockerfile must pin the BuildKit syntax`,
    );
    // Base image must flow through an ARG so consumers can pin to an
    // immutable @sha256 digest at build time. The container-scan workflow
    // also warns when a FROM is not digest-pinned.
    assert.match(
      dockerfile,
      /^ARG\s+(NODE_IMAGE|BUN_IMAGE|DENO_IMAGE)=/m,
      `${template} Dockerfile must accept a base-image ARG for digest pinning`,
    );
    assert.match(
      dockerfile,
      /^FROM\s+\$\{(NODE_IMAGE|BUN_IMAGE|DENO_IMAGE)\}/m,
      `${template} Dockerfile must consume the base image via the ARG`,
    );
    // Non-root runtime user is non-negotiable.
    assert.match(
      dockerfile,
      /^USER\s+(app|bun|deno)\b/m,
      `${template} Dockerfile must drop to a non-root user`,
    );
    // STOPSIGNAL lets the framework's graceful-shutdown drain fire.
    assert.match(
      dockerfile,
      /^STOPSIGNAL\s+SIGTERM\b/m,
      `${template} Dockerfile must set STOPSIGNAL SIGTERM`,
    );
    // HEALTHCHECK must be present and must hit the local loopback (not a
    // remote host) so a compromised DNS does not turn the healthcheck
    // into an outbound oracle.
    assert.match(
      dockerfile,
      /^HEALTHCHECK\s/m,
      `${template} Dockerfile must declare a HEALTHCHECK`,
    );
    assert.match(
      dockerfile,
      /http:\/\/127\.0\.0\.1:/,
      `${template} HEALTHCHECK must target 127.0.0.1`,
    );
    assert.match(
      dockerfile,
      /\/healthz/,
      `${template} HEALTHCHECK must use the scaffolded health route`,
    );
    assert.doesNotMatch(
      dockerfile,
      /\/readyz/,
      `${template} Dockerfile must not reference an unmounted readiness route`,
    );
    // No curl, no bash extras — keeps the runtime surface minimal and
    // denies attackers a convenient exfiltration / dropper tool.
    assert.doesNotMatch(
      dockerfile,
      /\bapk\s+add\b[^\n]*\bcurl\b/,
      `${template} Dockerfile must not install curl in the runner`,
    );
    // Lockfile-frozen, lifecycle-script-free dependency install matches
    // the .npmrc supply-chain defaults.
    assert.match(
      dockerfile,
      /(--frozen-lockfile|deno cache|--cached-only)/,
      `${template} Dockerfile must use a reproducible dependency install`,
    );
    // .dockerignore must keep secrets, VCS metadata, and CI config out
    // of the build context.
    assert.match(
      dockerignore,
      /^\.git$/m,
      `${template} .dockerignore must exclude .git`,
    );
    assert.match(
      dockerignore,
      /^\.env$/m,
      `${template} .dockerignore must exclude .env`,
    );
    assert.doesNotMatch(
      dockerignore,
      /^(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lock|bun\.lockb|deno\.lock)$/m,
      `${template} .dockerignore must keep lockfiles in the build context`,
    );
    if (template === "deno-basic") {
      assert.match(dockerignore, /^\.deno\/$/m);
    } else {
      assert.match(dockerignore, /^\.pnpm-store\/$/m);
    }
  }
});

test("pnpm templates ship hardened supply-chain .npmrc defaults", async () => {
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
  ];

  for (const template of templates) {
    const source = await readFile(
      path.join(pkgRoot, "templates", template, "_npmrc"),
      "utf8",
    );
    assert.match(
      source,
      /^ignore-scripts=true$/m,
      `${template} should block dependency lifecycle scripts`,
    );
    assert.match(
      source,
      /^minimum-release-age=1440$/m,
      `${template} should wait 24h before fresh package installs`,
    );
    assert.match(
      source,
      /^verify-store-integrity=true$/m,
      `${template} should verify pnpm store integrity`,
    );
    assert.match(
      source,
      /^prefer-frozen-lockfile=true$/m,
      `${template} should prefer reproducible installs`,
    );
    assert.match(
      source,
      /^strict-peer-dependencies=true$/m,
      `${template} should fail closed on peer dependency drift`,
    );
  }
});

test("pnpm templates ship a local SCA `audit` script", async () => {
  // Aikido's "SCA in the IDE" write-up
  // (https://www.aikido.dev/blog/sca-in-ide-scan-and-fix-dependencies)
  // argues that developers should be able to scan their dependency tree
  // for known CVEs *locally*, not only in CI. DaloyJS already runs
  // `pnpm audit --prod` and OSV-Scanner on every PR and on a daily
  // schedule (see `.github/workflows/vuln-scan.yml` and
  // `.github/workflows/osv-scan.yml`), but the scaffolded user project
  // is the layer closest to the IDE. Every shippable template must
  // therefore expose an out-of-the-box `audit` script so a developer can
  // run a production-tree SCA scan with a single command from their
  // editor's task runner.
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
  ];

  for (const template of templates) {
    const pkg = JSON.parse(
      await readFile(
        path.join(pkgRoot, "templates", template, "package.json"),
        "utf8",
      ),
    );
    assert.equal(
      pkg.scripts.audit,
      "pnpm audit --prod",
      `${template} should ship an \`audit\` script for local SCA scans`,
    );
  }
});

test("pnpm templates ship workspace-level supply-chain defaults", async () => {
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
  ];

  for (const template of templates) {
    const source = await readFile(
      path.join(pkgRoot, "templates", template, "pnpm-workspace.yaml"),
      "utf8",
    );
    assert.match(
      source,
      /^minimumReleaseAge:\s*1440$/m,
      `${template} pnpm-workspace.yaml should wait 24h before fresh package installs`,
    );
    assert.match(
      source,
      /^blockExoticSubdeps:\s*true$/m,
      `${template} pnpm-workspace.yaml should block exotic subdependency sources`,
    );
  }
});

test("pnpm scaffolds keep hardened .npmrc", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pnpm-secure";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const npmrc = await readFile(
      path.join(tmpDir, projectName, ".npmrc"),
      "utf8",
    );
    assert.match(npmrc, /^ignore-scripts=true$/m);
    assert.match(npmrc, /^minimum-release-age=1440$/m);

    const workspace = await readFile(
      path.join(tmpDir, projectName, "pnpm-workspace.yaml"),
      "utf8",
    );
    assert.match(workspace, /^minimumReleaseAge:\s*1440$/m);
    assert.match(workspace, /^blockExoticSubdeps:\s*true$/m);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("non-pnpm scaffolds do not keep pnpm-specific .npmrc or pnpm-workspace.yaml", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "npm-clean";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "vercel-edge",
          "--package-manager",
          "npm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    await assert.rejects(access(path.join(tmpDir, projectName, ".npmrc")));
    await assert.rejects(
      access(path.join(tmpDir, projectName, "pnpm-workspace.yaml")),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci scaffolds hardened GitHub security files for pnpm projects", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pnpm-ci";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--with-ci",
          "--code-owner",
          "@acme/security",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const projectDir = path.join(tmpDir, projectName);
    await access(path.join(projectDir, ".github/workflows/ci.yml"));
    await access(path.join(projectDir, ".github/workflows/deploy.yml"));
    await access(path.join(projectDir, ".github/workflows/vuln-scan.yml"));
    await access(path.join(projectDir, ".github/workflows/osv-scan.yml"));
    await access(path.join(projectDir, ".github/workflows/codeql.yml"));
    await access(path.join(projectDir, ".github/workflows/scorecard.yml"));
    await access(path.join(projectDir, ".github/workflows/zizmor.yml"));
    await access(path.join(projectDir, ".github/workflows/container-scan.yml"));
    await access(path.join(projectDir, ".github/workflows/dast.yml"));
    await access(path.join(projectDir, ".github/workflows/opengrep.yml"));
    await access(path.join(projectDir, ".github/workflows/secret-scan.yml"));
    await access(path.join(projectDir, ".github/dependabot.yml"));
    await access(path.join(projectDir, "SECURITY.md"));
    await access(path.join(projectDir, "scripts/verify-lockfile-sources.mjs"));

    // create-daloy scaffolds REST API services, not libraries. The npm
    // publish workflow is intentionally omitted so fork PRs cannot reach
    // `id-token: write` or any npm credential by accident.
    await assert.rejects(
      access(path.join(projectDir, ".github/workflows/release.yml")),
    );

    const pkg = JSON.parse(
      await readFile(path.join(projectDir, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["verify:lockfile"],
      "node scripts/verify-lockfile-sources.mjs",
    );

    const ci = await readFile(
      path.join(projectDir, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.match(ci, /permissions:\s*\{\}/);
    assert.doesNotMatch(ci, /^\s*pull_request_target:/m);
    assert.doesNotMatch(ci, /cache:\s*pnpm/);
    assert.match(ci, /pnpm install --frozen-lockfile --ignore-scripts/);
    assert.match(ci, /pnpm verify:lockfile/);
    assert.match(ci, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(ci, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(ci, /pnpm\/action-setup@[0-9a-f]{40}\s+# v6/);
    assert.match(ci, /actions\/setup-node@[0-9a-f]{40}\s+# v6/);
    assert.doesNotMatch(ci, /__[A-Z_]+__/);

    const deploy = await readFile(
      path.join(projectDir, ".github/workflows/deploy.yml"),
      "utf8",
    );
    assert.match(deploy, /on:\s*\n\s*workflow_dispatch:/);
    assert.match(deploy, /permissions:\s*\{\}/);
    assert.match(deploy, /environment:\s*\n\s*name:\s*production/);
    assert.match(deploy, /packages:\s*write/);
    assert.match(deploy, /id-token:\s*write/);
    assert.match(deploy, /docker login ghcr\.io/);
    assert.match(deploy, /docker build/);
    assert.match(deploy, /docker push/);
    // Image signing + SBOM attestation (Aikido container-security checklist).
    assert.match(deploy, /sigstore\/cosign-installer@[0-9a-f]{40}\s+# v4/);
    assert.match(deploy, /anchore\/sbom-action@[0-9a-f]{40}\s+# v0/);
    assert.match(deploy, /cosign sign --yes/);
    assert.match(deploy, /cosign attest --yes/);
    assert.match(deploy, /--type spdxjson/);
    assert.match(deploy, /IMAGE_DIGEST=/);
    assert.match(deploy, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(deploy, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(deploy, /pnpm verify:lockfile/);
    assert.match(deploy, /if: github\.ref == 'refs\/heads\/main' \|\| github\.ref_type == 'tag'/);
    assert.doesNotMatch(deploy, /pull_request_target/);
    assert.doesNotMatch(deploy, /__[A-Z_]+__/);

    const vulnScan = await readFile(
      path.join(projectDir, ".github/workflows/vuln-scan.yml"),
      "utf8",
    );
    assert.match(vulnScan, /name: Vuln scan/);
    assert.match(vulnScan, /pnpm install --frozen-lockfile --ignore-scripts/);
    assert.match(vulnScan, /pnpm audit --prod/);
    assert.match(vulnScan, /Audit full dependency tree \(advisory\)/);
    assert.match(vulnScan, /continue-on-error: true/);
    assert.match(vulnScan, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(vulnScan, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(vulnScan, /cron: "13 6 \* \* \*"/);
    assert.doesNotMatch(vulnScan, /__[A-Z_]+__/);

    // Second-source SCA gate (Aikido "SAST vs SCA" / npm-audit-guide).
    // OSV-Scanner is downloaded by pinned SHA-256 from the official
    // google/osv-scanner release — no third-party action wrapper.
    const osvScan = await readFile(
      path.join(projectDir, ".github/workflows/osv-scan.yml"),
      "utf8",
    );
    assert.match(osvScan, /name: OSV scan/);
    assert.match(osvScan, /permissions:\s*\{\}/);
    assert.match(osvScan, /OSV_SCANNER_VERSION:/);
    assert.match(osvScan, /OSV_SCANNER_SHA256:\s*"[0-9a-f]{64}"/);
    assert.match(osvScan, /sha256sum --check --status/);
    assert.match(osvScan, /\.\/osv-scanner scan source --recursive/);
    assert.match(osvScan, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(osvScan, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(osvScan, /cron: "47 6 \* \* \*"/);
    assert.doesNotMatch(osvScan, /uses:\s*google\/osv-scanner-action/);

    const containerScan = await readFile(
      path.join(projectDir, ".github/workflows/container-scan.yml"),
      "utf8",
    );
    assert.match(containerScan, /hadolint\/hadolint-action@[0-9a-f]{40}\s+# v3/);
    assert.match(containerScan, /aquasecurity\/trivy-action@[0-9a-f]{40}\s+# v0/);
    assert.match(containerScan, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(containerScan, /scan-type: fs/);
    assert.match(containerScan, /image-ref: local\/app:scan/);
    // Pin check: surface unpinned `FROM` lines per Aikido x Root.io
    // 2026 "Harden your containers without the headaches".
    assert.match(containerScan, /Pin check \(FROM @sha256 digest\)/);
    assert.match(containerScan, /is not pinned to a @sha256/);
    // IaC misconfig coverage per Aikido's "IaC security scanning for
    // Terraform & Kubernetes misconfigurations" article — Trivy's
    // `misconfig` scanner runs on every PR alongside vuln + secret.
    assert.match(containerScan, /scanners: vuln,secret,misconfig/);
    assert.match(containerScan, /\*\*\/\*\.tf/);
    assert.match(containerScan, /k8s\/\*\*/);
    assert.doesNotMatch(containerScan, /__[A-Z_]+__/);

    const secretScan = await readFile(
      path.join(projectDir, ".github/workflows/secret-scan.yml"),
      "utf8",
    );
    // History-aware scan per Aikido "Secrets Detection: A Practical
    // Guide" — scan the working tree on every PR and the full git
    // history on a daily schedule.
    assert.match(secretScan, /name: Secret scan/);
    assert.match(secretScan, /permissions:\s*\{\}/);
    assert.match(secretScan, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(secretScan, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(secretScan, /persist-credentials: false/);
    assert.match(secretScan, /GITLEAKS_VERSION:/);
    assert.match(secretScan, /GITLEAKS_SHA256:\s*"[0-9a-f]{64}"/);
    assert.match(secretScan, /sha256sum --check --strict/);
    assert.match(secretScan, /gitleaks dir --no-banner --redact --verbose --exit-code 1/);
    assert.match(secretScan, /gitleaks git --no-banner --redact --verbose --exit-code 1/);
    assert.match(secretScan, /github\.event_name == 'schedule'/);
    assert.doesNotMatch(secretScan, /__[A-Z_]+__/);
    // No third-party action introduced just for secret scanning.
    assert.doesNotMatch(secretScan, /gitleaks\/gitleaks-action/);

    const dependabotConfig = await readFile(
      path.join(projectDir, ".github/dependabot.yml"),
      "utf8",
    );
    assert.match(dependabotConfig, /package-ecosystem: docker/);

    // Runtime hardening flags from the Aikido "Container Security — The
    // Dev Guide" mapping. The build-time controls (image scan, base
    // pin, non-root user) are tested above; this block guards the
    // runtime-side `docker run` / Compose flags the scaffolded
    // SECURITY.md prescribes so future edits cannot drop them.
    const scaffoldedSecurity = await readFile(
      path.join(projectDir, "SECURITY.md"),
      "utf8",
    );
    assert.match(scaffoldedSecurity, /Runtime hardening/);
    assert.match(scaffoldedSecurity, /--read-only/);
    assert.match(scaffoldedSecurity, /--cap-drop=ALL/);
    assert.match(scaffoldedSecurity, /no-new-privileges:true/);
    assert.match(scaffoldedSecurity, /--pids-limit=256/);
    assert.match(scaffoldedSecurity, /--memory=512m/);
    assert.match(scaffoldedSecurity, /Never.*--privileged/);
    assert.match(scaffoldedSecurity, /container-security-guide/);

    const codeowners = await readFile(
      path.join(projectDir, ".github/CODEOWNERS"),
      "utf8",
    );
    assert.match(codeowners, /\* @acme\/security/);
    assert.match(
      codeowners,
      /\/\.github\/workflows\/vuln-scan\.yml\s+@acme\/security/,
    );
    assert.match(
      codeowners,
      /\/\.github\/workflows\/osv-scan\.yml\s+@acme\/security/,
    );
    assert.doesNotMatch(codeowners, /release\.yml/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci keeps non-pnpm scaffolds clean while generating matching CI commands", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "npm-ci";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "npm",
          "--with-ci",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const projectDir = path.join(tmpDir, projectName);
    await assert.rejects(access(path.join(projectDir, ".npmrc")));
    await assert.rejects(access(path.join(projectDir, "pnpm-workspace.yaml")));

    const pkg = JSON.parse(
      await readFile(path.join(projectDir, "package.json"), "utf8"),
    );
    assert.equal(pkg.scripts.gen, "npm run gen:openapi && npm run gen:client");
    assert.equal(
      pkg.scripts["verify:lockfile"],
      "node scripts/verify-lockfile-sources.mjs",
    );

    const ci = await readFile(
      path.join(projectDir, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.match(ci, /npm ci --ignore-scripts/);
    assert.match(ci, /npm run verify:lockfile/);
    assert.match(ci, /npm run typecheck/);
    assert.match(ci, /npm test/);
    assert.doesNotMatch(ci, /pnpm\/action-setup/);
    assert.doesNotMatch(ci, /__[A-Z_]+__/);

    const vulnScan = await readFile(
      path.join(projectDir, ".github/workflows/vuln-scan.yml"),
      "utf8",
    );
    assert.match(vulnScan, /npm ci --ignore-scripts/);
    assert.match(vulnScan, /npm audit --omit=dev/);
    assert.match(vulnScan, /Audit full dependency tree \(advisory\)/);
    assert.match(vulnScan, /run: npm audit/);
    assert.match(vulnScan, /continue-on-error: true/);
    assert.doesNotMatch(vulnScan, /pnpm\/action-setup/);
    assert.doesNotMatch(vulnScan, /__[A-Z_]+__/);

    const dockerfile = await readFile(path.join(projectDir, "Dockerfile"), "utf8");
    assert.match(
      dockerfile,
      /COPY package\.json package-lock\.json\* npm-shrinkwrap\.json\* \./,
    );
    assert.match(dockerfile, /RUN npm ci --ignore-scripts/);
    assert.match(dockerfile, /RUN npm run build/);
    assert.doesNotMatch(
      dockerfile,
      /pnpm install --frozen-lockfile --ignore-scripts/,
    );

    const dockerignore = await readFile(path.join(projectDir, ".dockerignore"), "utf8");
    assert.match(dockerignore, /^\.npm\/$/m);
    assert.doesNotMatch(dockerignore, /^\.pnpm-store\/$/m);
    assert.doesNotMatch(dockerignore, /^package-lock\.json$/m);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("Docker ignore scaffolding follows the selected yarn package manager", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "yarn-pm-dockerignore";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "yarn",
          "--no-ci",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const dockerfile = await readFile(
      path.join(tmpDir, projectName, "Dockerfile"),
      "utf8",
    );
    assert.match(dockerfile, /COPY package\.json yarn\.lock\* \./);
    assert.match(dockerfile, /RUN corepack enable && yarn install --frozen-lockfile --ignore-scripts/);

    const dockerignore = await readFile(
      path.join(tmpDir, projectName, ".dockerignore"),
      "utf8",
    );
    assert.match(dockerignore, /^\.yarn\/cache\/$/m);
    assert.match(dockerignore, /^\.yarn\/unplugged\/$/m);
    assert.match(dockerignore, /^\.yarn\/build-state\.yml$/m);
    assert.match(dockerignore, /^\.yarn\/install-state\.gz$/m);
    assert.match(dockerignore, /^\.pnp\.\*$/m);
    assert.doesNotMatch(dockerignore, /^\.pnpm-store\/$/m);
    assert.doesNotMatch(dockerignore, /^yarn\.lock$/m);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("Dockerfile scaffolding follows the selected bun package manager", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    for (const template of ["node-basic", "bun-basic"]) {
      const projectName = `bun-pm-docker-${template}`;
      const exitCode = await new Promise((resolve) => {
        const proc = spawn(
          process.execPath,
          [
            path.join(pkgRoot, "bin/create-daloy.mjs"),
            projectName,
            "--template",
            template,
            "--package-manager",
            "bun",
            "--no-ci",
            "--no-install",
            "--no-git",
            "--yes",
          ],
          { cwd: tmpDir, stdio: "ignore" },
        );
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
      });
      assert.equal(exitCode, 0);

      const dockerfile = await readFile(
        path.join(tmpDir, projectName, "Dockerfile"),
        "utf8",
      );
      assert.match(dockerfile, /^ARG BUN_IMAGE=oven\/bun:1-alpine$/m);
      assert.match(dockerfile, /^FROM \$\{BUN_IMAGE\} AS builder$/m);
      assert.match(dockerfile, /COPY package\.json bun\.lock\* bun\.lockb\* \./);
      assert.match(dockerfile, /RUN bun install --frozen-lockfile --ignore-scripts/);
      if (template === "node-basic") {
        assert.match(dockerfile, /RUN bun run build/);
        assert.match(dockerfile, /^FROM \$\{NODE_IMAGE\} AS runner$/m);
      } else {
        assert.doesNotMatch(dockerfile, /RUN bun run build/);
        assert.match(dockerfile, /^FROM \$\{BUN_IMAGE\} AS runner$/m);
      }
      assert.doesNotMatch(
        dockerfile,
        /pnpm install --frozen-lockfile --ignore-scripts/,
      );

      const dockerignore = await readFile(
        path.join(tmpDir, projectName, ".dockerignore"),
        "utf8",
      );
      assert.match(dockerignore, /^\.bun\/$/m);
      assert.doesNotMatch(dockerignore, /^\.pnpm-store\/$/m);
      assert.doesNotMatch(dockerignore, /^bun\.lockb?$/m);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci adds Bun runtime setup when bun-basic uses pnpm", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "bun-ci";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "bun-basic",
          "--package-manager",
          "pnpm",
          "--with-ci",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const ci = await readFile(
      path.join(tmpDir, projectName, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.match(ci, /pnpm install --frozen-lockfile --ignore-scripts/);
    assert.match(ci, /oven-sh\/setup-bun@[0-9a-f]{40}\s+# v2/);
    assert.match(ci, /pnpm test/);
    assert.doesNotMatch(ci, /__[A-Z_]+__/);

    const deploy = await readFile(
      path.join(tmpDir, projectName, ".github/workflows/deploy.yml"),
      "utf8",
    );
    assert.match(deploy, /packages:\s*write/);
    assert.match(deploy, /docker build/);
    assert.doesNotMatch(deploy, /__[A-Z_]+__/);

    const dockerfile = await readFile(
      path.join(tmpDir, projectName, "Dockerfile"),
      "utf8",
    );
    assert.match(dockerfile, /^FROM \$\{NODE_IMAGE\} AS builder$/m);
    assert.match(dockerfile, /^FROM \$\{BUN_IMAGE\} AS runner$/m);
    assert.match(dockerfile, /pnpm install --frozen-lockfile --ignore-scripts/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci --no-deploy keeps the security bundle but omits deploy.yml", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "ci-no-deploy";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "npm",
          "--with-ci",
          "--no-deploy",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const projectDir = path.join(tmpDir, projectName);
    await access(path.join(projectDir, ".github/workflows/ci.yml"));
    await assert.rejects(access(path.join(projectDir, ".github/workflows/deploy.yml")));
    await access(path.join(projectDir, ".github/CODEOWNERS"));
    await access(path.join(projectDir, "SECURITY.md"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-deploy --no-ci scaffolds deploy.yml without the rest of the security bundle", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "deploy-only";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "npm",
          "--with-deploy",
          "--no-ci",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const projectDir = path.join(tmpDir, projectName);
    await access(path.join(projectDir, ".github/workflows/deploy.yml"));
    await assert.rejects(access(path.join(projectDir, ".github/workflows/ci.yml")));
    await assert.rejects(access(path.join(projectDir, ".github/workflows/secret-scan.yml")));
    await assert.rejects(access(path.join(projectDir, ".github/CODEOWNERS")));
    await assert.rejects(access(path.join(projectDir, ".github/dependabot.yml")));
    await assert.rejects(access(path.join(projectDir, "SECURITY.md")));
    await assert.rejects(access(path.join(projectDir, "scripts/verify-lockfile-sources.mjs")));

    const pkg = JSON.parse(await readFile(path.join(projectDir, "package.json"), "utf8"));
    assert.equal(pkg.scripts["verify:lockfile"], undefined);

    // In deploy-only mode the verify:lockfile script does not exist on disk,
    // so the deploy workflow must omit the corresponding step rather than
    // fail fast on a missing file. The ref guard still applies.
    const deploy = await readFile(
      path.join(projectDir, ".github/workflows/deploy.yml"),
      "utf8",
    );
    assert.doesNotMatch(deploy, /verify:lockfile/);
    assert.match(deploy, /if: github\.ref == 'refs\/heads\/main' \|\| github\.ref_type == 'tag'/);
    assert.doesNotMatch(deploy, /__[A-Z_]+__/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci composes with --minimal and rejects an invalid --code-owner", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const okProject = "ci-minimal";
  const badProject = "ci-bad-owner";
  try {
    // Happy path: --with-ci + --minimal should still produce hardened CI plus a
    // stripped scaffold with no leftover sentinel comments.
    const okExit = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          okProject,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--with-ci",
          "--minimal",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(okExit, 0);
    const projectDir = path.join(tmpDir, okProject);
    const ci = await readFile(
      path.join(projectDir, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.match(ci, /pnpm install --frozen-lockfile --ignore-scripts/);
    assert.doesNotMatch(ci, /__[A-Z_]+__/);
    const buildApp = await readFile(
      path.join(projectDir, "src/build-app.ts"),
      "utf8",
    );
    assert.doesNotMatch(buildApp, /\/books\/:id/);
    assert.doesNotMatch(buildApp, /daloy-minimal:strip-/);
    assert.match(buildApp, /\/healthz/);

    // Unhappy path: an obviously broken --code-owner must fail fast and not
    // leave a half-finished project on disk that would silently land in CI.
    const badExit = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          badProject,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--with-ci",
          "--code-owner",
          "not a handle",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.notEqual(badExit, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci emits one Bun audit step when Bun is the package manager", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "bun-audit-ci";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "bun-basic",
          "--package-manager",
          "bun",
          "--with-ci",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const vulnScan = await readFile(
      path.join(tmpDir, projectName, ".github/workflows/vuln-scan.yml"),
      "utf8",
    );
    assert.match(vulnScan, /oven-sh\/setup-bun@[0-9a-f]{40}\s+# v2/);
    assert.match(vulnScan, /bun install --frozen-lockfile --ignore-scripts/);
    assert.match(vulnScan, /Audit dependencies \(blocking\)/);
    assert.match(vulnScan, /run: bun audit/);
    assert.doesNotMatch(vulnScan, /Audit full dependency tree \(advisory\)/);
    assert.doesNotMatch(vulnScan, /__[A-Z_]+__/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci scaffolds runtime-native security files for deno-basic", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "deno-ci";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "deno-basic",
          "--with-ci",
          "--code-owner=@acme/security",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);

    const projectDir = path.join(tmpDir, projectName);
    await assert.rejects(access(path.join(projectDir, "package.json")));
    await assert.rejects(
      access(path.join(projectDir, ".github/workflows/release.yml")),
    );
    await access(path.join(projectDir, ".github/workflows/deploy.yml"));
    await assert.rejects(
      access(path.join(projectDir, "scripts/verify-lockfile-sources.mjs")),
    );
    await access(path.join(projectDir, ".github/workflows/container-scan.yml"));
    await access(path.join(projectDir, ".github/workflows/osv-scan.yml"));

    const ci = await readFile(
      path.join(projectDir, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.match(ci, /denoland\/setup-deno@[0-9a-f]{40}\s+# v2\.0\.4/);
    assert.match(ci, /deno task typecheck/);
    assert.match(ci, /deno task test/);
    assert.doesNotMatch(ci, /pull_request_target/);

    // Second-source SCA gate for the Deno scaffold (Aikido "SAST vs
    // SCA"). Deno has no `audit` built in, so OSV-Scanner is the only
    // scheduled SCA layer covering `deno.lock`.
    const osvScan = await readFile(
      path.join(projectDir, ".github/workflows/osv-scan.yml"),
      "utf8",
    );
    assert.match(osvScan, /name: OSV scan/);
    assert.match(osvScan, /permissions:\s*\{\}/);
    assert.match(osvScan, /OSV_SCANNER_VERSION:/);
    assert.match(osvScan, /OSV_SCANNER_SHA256:\s*"[0-9a-f]{64}"/);
    assert.match(osvScan, /sha256sum --check --status/);
    assert.match(osvScan, /--lockfile=deno\.lock/);
    assert.match(osvScan, /step-security\/harden-runner@[0-9a-f]{40}\s+# v2/);
    assert.match(osvScan, /actions\/checkout@[0-9a-f]{40}\s+# v6/);
    assert.match(osvScan, /cron: "47 6 \* \* \*"/);
    assert.doesNotMatch(osvScan, /uses:\s*google\/osv-scanner-action/);

    const dependabot = await readFile(
      path.join(projectDir, ".github/dependabot.yml"),
      "utf8",
    );
    assert.match(dependabot, /package-ecosystem: github-actions/);
    assert.match(dependabot, /package-ecosystem: docker/);
    assert.doesNotMatch(dependabot, /package-ecosystem: npm/);

    const containerScan = await readFile(
      path.join(projectDir, ".github/workflows/container-scan.yml"),
      "utf8",
    );
    assert.match(
      containerScan,
      /DENO_IMAGE=denoland\/deno:alpine@sha256:<digest>/,
    );
    assert.match(containerScan, /aquasecurity\/trivy-action@[0-9a-f]{40}\s+# v0/);
    // IaC misconfig coverage per Aikido's "IaC security scanning for
    // Terraform & Kubernetes misconfigurations" article.
    assert.match(containerScan, /scanners: vuln,secret,misconfig/);
    assert.match(containerScan, /\*\*\/\*\.tf/);
    assert.match(containerScan, /k8s\/\*\*/);

    const deploy = await readFile(
      path.join(projectDir, ".github/workflows/deploy.yml"),
      "utf8",
    );
    assert.match(deploy, /on:\s*\n\s*workflow_dispatch:/);
    assert.match(deploy, /packages:\s*write/);
    assert.match(deploy, /id-token:\s*write/);
    assert.match(deploy, /denoland\/setup-deno@[0-9a-f]{40}\s+# v2\.0\.4/);
    assert.match(deploy, /docker login ghcr\.io/);
    assert.match(deploy, /sigstore\/cosign-installer@[0-9a-f]{40}\s+# v4/);
    assert.match(deploy, /anchore\/sbom-action@[0-9a-f]{40}\s+# v0/);
    assert.match(deploy, /cosign sign --yes/);
    assert.match(deploy, /cosign attest --yes/);
    assert.match(deploy, /if: github\.ref == 'refs\/heads\/main' \|\| github\.ref_type == 'tag'/);
    assert.doesNotMatch(deploy, /__[A-Z_]+__/);

    const codeowners = await readFile(
      path.join(projectDir, ".github/CODEOWNERS"),
      "utf8",
    );
    assert.match(codeowners, /\* @acme\/security/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("npm scaffold rewrites pnpm-prefixed scripts so `npm run gen` works", async () => {
  // The node-basic template intentionally authors scripts with `pnpm <sub>`
  // because pnpm is the recommended manager. When a user opts into npm we
  // must rewrite those calls or `npm run gen` falls over with
  // `pnpm: command not found`.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "npm-gen";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "npm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, projectName, "package.json"), "utf8"),
    );
    assert.equal(pkg.scripts.gen, "npm run gen:openapi && npm run gen:client");
    assert.equal(pkg.scripts.audit, "npm audit --prod");
    // Sanity: scripts that don't reference pnpm must remain untouched.
    assert.equal(pkg.scripts.dev, "daloy dev");

    const readme = await readFile(
      path.join(tmpDir, projectName, "README.md"),
      "utf8",
    );
    assert.match(readme, /npm install/);
    assert.match(readme, /npm run dev/);
    assert.match(readme, /npm run gen/);
    assert.match(readme, /npm run build/);
    assert.doesNotMatch(readme, /pnpm/);
    assert.doesNotMatch(readme, /Hardened `\.npmrc`/);

    const agents = await readFile(
      path.join(tmpDir, projectName, "AGENTS.md"),
      "utf8",
    );
    assert.match(agents, /Package manager: npm\./);
    assert.match(agents, /npm run dev/);
    assert.match(agents, /npm run typecheck/);
    assert.match(agents, /npm test/);
    assert.match(agents, /npm run gen/);
    assert.doesNotMatch(agents, /pnpm/);

    const skill = await readFile(
      path.join(
        tmpDir,
        projectName,
        ".agents/skills/daloyjs-best-practices/SKILL.md",
      ),
      "utf8",
    );
    assert.match(skill, /npm run gen/);
    assert.match(skill, /npm run gen:openapi/);
    assert.match(skill, /npm run gen:client/);
    assert.match(skill, /npm run typecheck/);
    assert.match(skill, /npm test/);
    assert.match(skill, /npm install <package>/);
    assert.doesNotMatch(skill, /pnpm/);
    assert.doesNotMatch(skill, /hardened `\.npmrc`/i);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--with-ci scaffolds provider-specific deploy starters for edge adapters", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    const cases = [
      {
        projectName: "vercel-deploy",
        template: "vercel-edge",
        packageManager: "npm",
        expected: [/npx vercel deploy --prod --yes --token/, /VERCEL_TOKEN/, /VERCEL_PROJECT_ID/],
      },
      {
        projectName: "cloudflare-deploy",
        template: "cloudflare-worker",
        packageManager: "pnpm",
        expected: [/pnpm exec wrangler deploy/, /CLOUDFLARE_API_TOKEN/, /CLOUDFLARE_ACCOUNT_ID/],
      },
    ];

    for (const testCase of cases) {
      const exitCode = await new Promise((resolve) => {
        const proc = spawn(
          process.execPath,
          [
            path.join(pkgRoot, "bin/create-daloy.mjs"),
            testCase.projectName,
            "--template",
            testCase.template,
            "--package-manager",
            testCase.packageManager,
            "--with-ci",
            "--no-install",
            "--no-git",
            "--yes",
          ],
          { cwd: tmpDir, stdio: "ignore" },
        );
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
      });
      assert.equal(exitCode, 0);

      const deploy = await readFile(
        path.join(tmpDir, testCase.projectName, ".github/workflows/deploy.yml"),
        "utf8",
      );
      assert.match(deploy, /on:\s*\n\s*workflow_dispatch:/);
      assert.match(deploy, /environment:\s*\n\s*name:\s*production/);
      assert.match(deploy, /if: github\.ref == 'refs\/heads\/main' \|\| github\.ref_type == 'tag'/);
      assert.match(deploy, /verify:lockfile/);
      for (const expected of testCase.expected) {
        assert.match(deploy, expected);
      }
      assert.doesNotMatch(deploy, /packages:\s*write/);
      assert.doesNotMatch(deploy, /__[A-Z_]+__/);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("pnpm scaffold leaves pnpm-prefixed scripts untouched", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pnpm-gen";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, projectName, "package.json"), "utf8"),
    );
    assert.equal(pkg.scripts.gen, "pnpm gen:openapi && pnpm gen:client");
    assert.equal(pkg.scripts.audit, "pnpm audit --prod");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("bun-basic template ships secure defaults and a Bun adapter entry", async () => {
  const buildApp = await readFile(
    path.join(pkgRoot, "templates/bun-basic/src/build-app.ts"),
    "utf8",
  );
  // Same secure defaults as node-basic.
  assert.match(buildApp, /requestId\(\)/);
  assert.match(buildApp, /secureHeaders\(\)/);
  assert.match(buildApp, /rateLimit\(/);
  // Health route preserves the literal types so codegen sees ok: true.
  assert.match(
    buildApp,
    /body:\s*\{ ok: true as const, runtime: "bun" as const \}/,
  );
  // The buildApp factory must not import the Bun adapter.
  assert.doesNotMatch(buildApp, /from\s+"@daloyjs\/core\/bun"/);

  const indexFile = await readFile(
    path.join(pkgRoot, "templates/bun-basic/src/index.ts"),
    "utf8",
  );
  assert.match(indexFile, /from\s+"@daloyjs\/core\/bun"/);
  assert.match(indexFile, /\bserve\s*\(\s*app\b/);

  const pkg = JSON.parse(
    await readFile(
      path.join(pkgRoot, "templates/bun-basic/package.json"),
      "utf8",
    ),
  );
  assert.equal(pkg.scripts.dev, "daloy dev --runtime bun");
  assert.equal(pkg.scripts.test, "bun test");
});

test("deno-basic template ships a runtime-native scaffold", async () => {
  const buildApp = await readFile(
    path.join(pkgRoot, "templates/deno-basic/src/build-app.ts"),
    "utf8",
  );
  assert.match(buildApp, /requestId\(\)/);
  assert.match(buildApp, /secureHeaders\(\)/);
  assert.match(
    buildApp,
    /body:\s*\{ ok: true as const, runtime: "deno" as const \}/,
  );
  // Factory must not import the Deno adapter.
  assert.doesNotMatch(buildApp, /from\s+"@daloyjs\/core\/deno"/);

  const main = await readFile(
    path.join(pkgRoot, "templates/deno-basic/src/main.ts"),
    "utf8",
  );
  assert.match(main, /from\s+"@daloyjs\/core\/deno"/);
  assert.match(main, /\bserve\s*\(\s*app\b/);

  const denoJson = JSON.parse(
    await readFile(
      path.join(pkgRoot, "templates/deno-basic/deno.json"),
      "utf8",
    ),
  );
  assert.match(denoJson.tasks.dev, /^deno run.*--watch src\/main\.ts$/);
  assert.match(denoJson.tasks.test, /^deno test\b/);
  assert.equal(denoJson.imports["@daloyjs/core"], "npm:@daloyjs/core@^0.35.1");
  assert.equal(
    denoJson.imports["@daloyjs/core/"],
    "npm:@daloyjs/core@^0.35.1/",
  );
});

test("--list-templates includes the new bun-basic and deno-basic options", async () => {
  const out = await new Promise((resolve) => {
    let buf = "";
    const proc = spawn(
      process.execPath,
      [path.join(pkgRoot, "bin/create-daloy.mjs"), "--list-templates"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    proc.stdout.on("data", (chunk) => (buf += chunk.toString()));
    proc.on("exit", () => resolve(buf));
    proc.on("error", () => resolve(buf));
  });
  assert.match(out, /bun-basic/);
  assert.match(out, /deno-basic/);
});

test("--help documents the create flow across package managers", async () => {
  const out = await new Promise((resolve) => {
    let buf = "";
    const proc = spawn(
      process.execPath,
      [path.join(pkgRoot, "bin/create-daloy.mjs"), "--help"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    proc.stdout.on("data", (chunk) => (buf += chunk.toString()));
    proc.on("exit", () => resolve(buf));
    proc.on("error", () => resolve(buf));
  });
  assert.match(out, /pnpm create daloy@latest/);
  assert.match(out, /npm\s+create daloy@latest/);
  assert.match(out, /yarn create daloy/);
  assert.match(out, /bun\s+create daloy/);
  assert.match(out, /--package-manager <pm>.*pnpm \| npm \| yarn \| bun/);
  assert.match(out, /--minimal/);
  assert.match(out, /--with-ci/);
  assert.match(out, /--code-owner/);
  assert.match(out, /https:\/\/daloyjs\.dev\/docs/);
});

test("create-daloy rejects unknown template and package manager values", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    const badTemplate = await runCreateDaloy([
      "bad-template",
      "--template",
      "rails",
      "--package-manager",
      "pnpm",
      "--no-install",
      "--no-git",
      "--yes",
    ], { cwd: tmpDir });
    assert.notEqual(badTemplate.exitCode, 0);
    assert.match(badTemplate.output, /Unknown template "rails"/);
    await assert.rejects(access(path.join(tmpDir, "bad-template")));

    const badPackageManager = await runCreateDaloy([
      "bad-pm",
      "--template",
      "node-basic",
      "--package-manager",
      "pip",
      "--no-install",
      "--no-git",
      "--yes",
    ], { cwd: tmpDir });
    assert.notEqual(badPackageManager.exitCode, 0);
    assert.match(badPackageManager.output, /Unknown --package-manager "pip"/);
    await assert.rejects(access(path.join(tmpDir, "bad-pm")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("create-daloy rejects invalid project names and unknown arguments", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    const badName = await runCreateDaloy([
      "Bad Name",
      "--template",
      "node-basic",
      "--package-manager",
      "pnpm",
      "--no-install",
      "--no-git",
      "--yes",
    ], { cwd: tmpDir });
    assert.notEqual(badName.exitCode, 0);
    assert.match(badName.output, /valid npm package name/);

    const unknownArg = await runCreateDaloy(["--definitely-unknown"], { cwd: tmpDir });
    assert.notEqual(unknownArg.exitCode, 0);
    assert.match(unknownArg.output, /Unknown argument: --definitely-unknown/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("create-daloy refuses to overwrite a non-empty directory without force", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "occupied";
  try {
    await mkdir(path.join(tmpDir, projectName));
    await writeFile(path.join(tmpDir, projectName, "README.md"), "existing\n");

    const result = await runCreateDaloy([
      projectName,
      "--template",
      "node-basic",
      "--package-manager",
      "pnpm",
      "--no-install",
      "--no-git",
      "--yes",
    ], { cwd: tmpDir });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /Directory occupied is not empty/);
    assert.equal(
      await readFile(path.join(tmpDir, projectName, "README.md"), "utf8"),
      "existing\n",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("non-interactive scaffold output includes the polished completion summary", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pretty-summary";
  try {
    const out = await new Promise((resolve) => {
      let buf = "";
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: ["ignore", "pipe", "pipe"] },
      );
      proc.stdout.on("data", (chunk) => (buf += chunk.toString()));
      proc.stderr.on("data", (chunk) => (buf += chunk.toString()));
      proc.on("exit", () => resolve(buf));
      proc.on("error", () => resolve(buf));
    });
    assert.match(out, /Welcome to DaloyJS/);
    assert.match(out, /Scaffolding your project/);
    assert.match(out, /Your DaloyJS project is ready!/);
    assert.match(out, /Next steps/);
    assert.match(out, new RegExp(`cd ${projectName}`));
    assert.match(out, /pnpm install/);
    assert.match(out, /pnpm run dev/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--minimal strips books + docs sentinel blocks from node-basic", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "minimal-node";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--minimal",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const buildApp = await readFile(
      path.join(tmpDir, projectName, "src/build-app.ts"),
      "utf8",
    );
    // Books and Swagger/OpenAPI demo routes should be gone.
    assert.doesNotMatch(buildApp, /\/books\/:id/);
    assert.doesNotMatch(buildApp, /\/openapi\.json/);
    assert.doesNotMatch(buildApp, /\/docs/);
    assert.doesNotMatch(buildApp, /daloy-minimal:strip-/);
    // Health route must stay.
    assert.match(buildApp, /\/healthz/);

    const indexFile = await readFile(
      path.join(tmpDir, projectName, "src/index.ts"),
      "utf8",
    );
    assert.doesNotMatch(indexFile, /Swagger UI/);
    assert.doesNotMatch(indexFile, /daloy-minimal:strip-/);
    assert.match(indexFile, /label: "Health"/);

    const readme = await readFile(
      path.join(tmpDir, projectName, "README.md"),
      "utf8",
    );
    assert.doesNotMatch(readme, /\/books\/1/);
    assert.doesNotMatch(readme, /localhost:3000\/docs/);
    assert.doesNotMatch(readme, /localhost:3000\/openapi\.json/);
    assert.doesNotMatch(readme, /daloy-minimal:strip-/);
    assert.match(readme, /\/healthz/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--minimal also trims the bun-basic and deno-basic templates", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    for (const template of ["bun-basic", "deno-basic"]) {
      const projectName = `minimal-${template}`;
      const exitCode = await new Promise((resolve) => {
        const proc = spawn(
          process.execPath,
          [
            path.join(pkgRoot, "bin/create-daloy.mjs"),
            projectName,
            "--template",
            template,
            "--minimal",
            "--no-install",
            "--no-git",
            "--yes",
          ],
          { cwd: tmpDir, stdio: "ignore" },
        );
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
      });
      assert.equal(
        exitCode,
        0,
        `scaffolding ${template} with --minimal should succeed`,
      );
      const buildApp = await readFile(
        path.join(tmpDir, projectName, "src/build-app.ts"),
        "utf8",
      );
      assert.doesNotMatch(
        buildApp,
        /\/books\/:id/,
        `${template} should drop books with --minimal`,
      );
      assert.doesNotMatch(
        buildApp,
        /daloy-minimal:strip-/,
        `${template} should remove sentinel comments`,
      );
      assert.match(
        buildApp,
        /\/healthz/,
        `${template} should keep healthz with --minimal`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("deno-basic scaffold skips package.json patching and never invokes a Node package manager", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "deno-runtime";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        // No --package-manager flag and no --no-install — the CLI must default
        // safely for runtime-only templates.
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "deno-basic",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    // No package.json should have been written.
    await assert.rejects(
      access(path.join(tmpDir, projectName, "package.json")),
    );
    // The deno.json must arrive verbatim with the project's import map.
    const denoJson = JSON.parse(
      await readFile(path.join(tmpDir, projectName, "deno.json"), "utf8"),
    );
    assert.ok(denoJson.tasks.dev);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("non-minimal scaffolds keep sentinel comments (so --minimal stays opt-in)", async () => {
  // The sentinels are plain `// daloy-minimal:strip-*` comments. They must
  // survive a default scaffold so a developer can run `--minimal` later
  // by re-scaffolding without a separate flag spec.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "keep-sentinels";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--no-install",
          "--no-git",
          "--yes",
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    const buildApp = await readFile(
      path.join(tmpDir, projectName, "src/build-app.ts"),
      "utf8",
    );
    assert.match(buildApp, /daloy-minimal:strip-start books/);
    assert.match(buildApp, /daloy-minimal:strip-end docs/);
    assert.match(buildApp, /\/books\/:id/);
    assert.match(buildApp, /\/openapi\.json/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("every template ships AGENTS.md and SKILL.md helper files for AI coding agents", async () => {
  // Both files are an open convention (see otherdocs/agents-doc.md and
  // otherdocs/skill-doc.md). Keeping them in every template means a freshly
  // scaffolded project gives Copilot/Claude/Cursor/etc. immediate context
  // without the user having to write anything.
  //
  // SKILL.md lives at `.agents/skills/daloyjs-best-practices/SKILL.md` so it
  // follows the open `agents/skills` directory convention. Templates author
  // it as `_agents/...` so npm pack does not drop the dotfolder on publish.
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
    "deno-basic",
  ];
  for (const template of templates) {
    const agents = await readFile(
      path.join(pkgRoot, "templates", template, "AGENTS.md"),
      "utf8",
    );
    const skill = await readFile(
      path.join(
        pkgRoot,
        "templates",
        template,
        "_agents/skills/daloyjs-best-practices/SKILL.md",
      ),
      "utf8",
    );

    // AGENTS.md is a curated summary that links to SKILL.md. Keep it under
    // ~6KB so it stays inside common agent instruction-context budgets while
    // still carrying enough best-practice content to be useful on its own.
    assert.ok(
      agents.length < 6000,
      `${template} AGENTS.md should stay under 6KB (was ${agents.length} bytes)`,
    );
    assert.match(
      agents,
      /\.agents\/skills\/daloyjs-best-practices\/SKILL\.md/,
      `${template} AGENTS.md should link to the new SKILL.md path`,
    );
    assert.match(
      agents,
      /DaloyJS/,
      `${template} AGENTS.md should describe the project`,
    );

    // SKILL.md must declare scope, structure, and at least one workflow.
    assert.match(
      skill,
      /When to use this skill/i,
      `${template} SKILL.md should define boundaries`,
    );
    assert.match(
      skill,
      /workflow/i,
      `${template} SKILL.md should describe workflows`,
    );
    assert.match(
      skill,
      /Pitfalls|guardrails/i,
      `${template} SKILL.md should list guardrails`,
    );
    // The expanded best-practices skill must cover testing and security.
    assert.match(
      skill,
      /Testing best practices/i,
      `${template} SKILL.md should describe testing best practices`,
    );
    assert.match(
      skill,
      /Security best practices/i,
      `${template} SKILL.md should describe security best practices`,
    );
  }
});

test("scaffolded projects include AGENTS.md and SKILL.md at the conventional paths", async () => {
  // Verify the CLI actually copies the helper files out of the template
  // (i.e. they are not accidentally renamed or filtered by the copier).
  // SKILL.md lives under `.agents/skills/daloyjs-best-practices/` after the
  // copier renames `_agents/` → `.agents/`.
  const templates = [
    "node-basic",
    "vercel-edge",
    "cloudflare-worker",
    "bun-basic",
    "deno-basic",
  ];
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  try {
    for (const template of templates) {
      const projectName = `agents-${template}`;
      const args = [
        path.join(pkgRoot, "bin/create-daloy.mjs"),
        projectName,
        "--template",
        template,
        "--no-install",
        "--no-git",
        "--yes",
      ];
      // Node-style templates also need an explicit package manager flag in
      // non-interactive mode; deno-basic ignores it.
      if (template !== "deno-basic") {
        args.push("--package-manager", "pnpm");
      }
      const exitCode = await new Promise((resolve) => {
        const proc = spawn(process.execPath, args, {
          cwd: tmpDir,
          stdio: "ignore",
        });
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
      });
      assert.equal(exitCode, 0, `scaffolding ${template} should succeed`);
      await access(path.join(tmpDir, projectName, "AGENTS.md"));
      await access(
        path.join(
          tmpDir,
          projectName,
          ".agents/skills/daloyjs-best-practices/SKILL.md",
        ),
      );
      // The `_agents` placeholder must be renamed to `.agents` on copy.
      await assert.rejects(access(path.join(tmpDir, projectName, "_agents")));
      // SKILL.md must not also be left at the repo root.
      await assert.rejects(access(path.join(tmpDir, projectName, "SKILL.md")));
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--yes + pnpm defaults install to N and skips dependency installation", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "pnpm-default-no-install";
  try {
    const { exitCode, stdout } = await new Promise((resolve) => {
      let buf = "";
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "pnpm",
          "--no-git",
          "--no-ci",
          "--yes",
          // intentionally omit --install / --no-install to exercise the default
        ],
        { cwd: tmpDir },
      );
      proc.stdout.on("data", (c) => (buf += c.toString()));
      proc.stderr.on("data", (c) => (buf += c.toString()));
      proc.on("exit", (code) => resolve({ exitCode: code ?? 1, stdout: buf }));
      proc.on("error", () => resolve({ exitCode: 1, stdout: buf }));
    });
    assert.equal(exitCode, 0);
    // Default-N for pnpm means node_modules must not exist.
    await assert.rejects(
      access(path.join(tmpDir, projectName, "node_modules")),
    );
    // Post-install hint about the supply-chain embargo must surface.
    assert.match(stdout, /minimumReleaseAge: 1440/);
    assert.match(stdout, /ignore-scripts/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--yes + non-pnpm package manager defaults --with-ci to Y", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "create-daloy-"));
  const projectName = "default-ci-on";
  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          path.join(pkgRoot, "bin/create-daloy.mjs"),
          projectName,
          "--template",
          "node-basic",
          "--package-manager",
          "npm",
          "--no-install",
          "--no-git",
          "--yes",
          // intentionally omit --with-ci / --no-ci to exercise the default
        ],
        { cwd: tmpDir, stdio: "ignore" },
      );
      proc.on("exit", (code) => resolve(code ?? 1));
      proc.on("error", () => resolve(1));
    });
    assert.equal(exitCode, 0);
    // CI bundle must be scaffolded by default now.
    await access(
      path.join(tmpDir, projectName, ".github/workflows/ci.yml"),
    );
    await access(
      path.join(tmpDir, projectName, ".github/workflows/deploy.yml"),
    );
    await access(path.join(tmpDir, projectName, ".github/CODEOWNERS"));
    await access(path.join(tmpDir, projectName, "SECURITY.md"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("--help documents the secure-by-default install + CI defaults", async () => {
  const out = await new Promise((resolve) => {
    let buf = "";
    const proc = spawn(
      process.execPath,
      [path.join(pkgRoot, "bin/create-daloy.mjs"), "--help"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    proc.stdout.on("data", (c) => (buf += c.toString()));
    proc.stderr.on("data", (c) => (buf += c.toString()));
    proc.on("exit", () => resolve(buf));
    proc.on("error", () => resolve(buf));
  });
  assert.match(out, /minimumReleaseAge/);
  assert.match(out, /ignore-scripts/);
  assert.match(out, /--with-ci.*\(default: Y\)/);
  assert.match(out, /--with-deploy.*inherits --with-ci/);
});
