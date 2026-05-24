/**
 * Tests for `scripts/verify-no-polyfill-cdns.ts` — the Aikido / Sansec
 * polyfill.io hijacked-CDN host gate.
 *
 * The verify script itself walks the repo; here we exercise its pure
 * core (`findForbiddenCdnReferences`) with synthetic fixtures so the
 * tests do not depend on the live tree, and then run a single
 * end-to-end assertion that the live repo passes the gate.
 */

import test from "node:test";
import assert from "node:assert/strict";

test("verify-no-polyfill-cdns flags every documented Funnull / polyfill.io IOC host", async () => {
  const { findForbiddenCdnReferences } = await import(
    "../scripts/verify-no-polyfill-cdns.js"
  );
  const sample = [
    "// unsafe: original hijacked polyfill CDN",
    '<script src="https://cdn.polyfill.io/v3/polyfill.min.js"></script>',
    "// unsafe: bare apex still under Funnull control",
    '<script src="https://polyfill.io/v3/polyfill.min.js"></script>',
    "// unsafe: registered alongside the takeover",
    '<script src="https://polyfill.com/v3/polyfill.min.js"></script>',
    "// unsafe: Sansec-listed alias",
    '<script src="https://polyfillcache.com/polyfill.min.js"></script>',
    "// unsafe: Sansec-listed squat",
    '<script src="https://polyfill-cdn.com/polyfill.min.js"></script>',
    "// unsafe: same Funnull operator",
    '<script src="https://bootcss.com/bootstrap.min.js"></script>',
    "// unsafe: same Funnull operator",
    '<script src="https://bootcdn.net/jquery.min.js"></script>',
    "// unsafe: same Funnull operator",
    '<script src="https://staticfile.org/vue/dist/vue.min.js"></script>',
    "// unsafe: same Funnull operator",
    '<script src="https://staticfile.net/vue/dist/vue.min.js"></script>',
    "// unsafe: Funnull C2 / ad-fraud",
    'fetch("https://unionadjs.com/track");',
    "// unsafe: Funnull C2 / ad-fraud",
    'fetch("https://xhsbpza.com/beacon");',
    "// unsafe: fake Google Analytics typosquat used by the polyfill payload",
    'location.href = "https://googie-anaiytics.com/redirect";',
  ].join("\n");
  const findings = findForbiddenCdnReferences("fixture.html", sample);
  assert.equal(findings.length, 12, JSON.stringify(findings, null, 2));
  assert.equal(findings[0]!.host, "cdn.polyfill.io");
  assert.equal(findings[1]!.host, "polyfill.io");
  assert.equal(findings[2]!.host, "polyfill.com");
  assert.equal(findings[3]!.host, "polyfillcache.com");
  assert.equal(findings[4]!.host, "polyfill-cdn.com");
  assert.equal(findings[5]!.host, "bootcss.com");
  assert.equal(findings[6]!.host, "bootcdn.net");
  assert.equal(findings[7]!.host, "staticfile.org");
  assert.equal(findings[8]!.host, "staticfile.net");
  assert.equal(findings[9]!.host, "unionadjs.com");
  assert.equal(findings[10]!.host, "xhsbpza.com");
  assert.equal(findings[11]!.host, "googie-anaiytics.com");
  for (const f of findings) {
    assert.match(
      f.reason,
      /Funnull|polyfill\.io|Sansec|Silent Push|Aikido/,
      `finding for ${f.host} must cite the campaign`,
    );
  }
});

test("verify-no-polyfill-cdns accepts safe CDN and mirror hosts", async () => {
  const { findForbiddenCdnReferences } = await import(
    "../scripts/verify-no-polyfill-cdns.js"
  );
  const sample = [
    "// safe: Cloudflare-operated polyfill mirror set up after the takedown",
    '<script src="https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js"></script>',
    "// safe: Fastly-operated polyfill mirror set up after the takedown",
    '<script src="https://polyfill-fastly.io/v3/polyfill.min.js"></script>',
    "// safe: pinned + SRI on a clean CDN — the recommended pattern",
    '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0" ' +
      'integrity="sha384-XXXXXX" crossorigin="anonymous"></script>',
    "// safe: a doc page that mentions \"polyfill\" as a word but not the IOC host",
    "// We have always avoided the polyfill keyword as a script tag.",
    "// safe: a hostname that ENDS in the IOC string but is not the IOC",
    '<script src="https://not-polyfill.io.example.test/x.js"></script>',
    "// safe: subdomain of an unrelated org with `polyfill` in the path, not host",
    '<script src="https://cdn.example.com/polyfill/v3.min.js"></script>',
  ].join("\n");
  const findings = findForbiddenCdnReferences("fixture.html", sample);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("verify-no-polyfill-cdns matches host inside JSON / Markdown / TS contexts", async () => {
  const { findForbiddenCdnReferences } = await import(
    "../scripts/verify-no-polyfill-cdns.js"
  );
  const jsonSample = '{"src": "https://cdn.polyfill.io/v3/polyfill.min.js"}';
  const mdSample = "Load it from `https://polyfill.io/v3/polyfill.min.js` in your `<head>`.";
  const tsSample = 'const url = "https://bootcss.com/bootstrap.min.js";';
  assert.equal(findForbiddenCdnReferences("a.json", jsonSample).length, 1);
  assert.equal(findForbiddenCdnReferences("b.md", mdSample).length, 1);
  assert.equal(findForbiddenCdnReferences("c.ts", tsSample).length, 1);
});

test("verify-no-polyfill-cdns accepts the live repository tree", async () => {
  // End-to-end smoke: spawn the verify script against the real repo and
  // assert exit code 0. This catches any newly-introduced IOC reference
  // anywhere under the scanned tree without the test itself having to
  // re-implement the file walker.
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const scriptUrl = new URL("../scripts/verify-no-polyfill-cdns.ts", import.meta.url);
  const scriptPath = fileURLToPath(scriptUrl);
  const exitCode: number = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && stderr) {
        console.error(stderr);
      }
      resolve(code ?? 1);
    });
  });
  assert.equal(
    exitCode,
    0,
    "The live repository tree must remain free of hijacked-CDN host references " +
      "(`cdn.polyfill.io`, `polyfill.io`, `polyfill.com`, `polyfillcache.com`, " +
      "`polyfill-cdn.com`, `bootcss.com`, `bootcdn.net`, `staticfile.org`, " +
      "`staticfile.net`, `unionadjs.com`, `xhsbpza.com`); see Aikido 2024-06-27 and " +
      "Sansec 2024-06-25.",
  );
});
