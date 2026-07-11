import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../src/index.js";
import {
  scalarHtml,
  swaggerUiHtml,
  redocHtml,
  htmlResponse,
  docsContentSecurityPolicy,
} from "../src/docs.js";
import { createLogger } from "../src/logger.js";
import { toFetchHandler as toCloudflareFetchHandler } from "../src/adapters/cloudflare.js";
import {
  toWebHandler,
  toRouteHandlers,
  toFetchHandler as toVercelFetchHandler,
} from "../src/adapters/vercel.js";
import { serve as serveBun } from "../src/adapters/bun.js";
import { serve as serveDeno } from "../src/adapters/deno.js";
import { toFastlyHandler, installFastlyListener } from "../src/adapters/fastly.js";
import { toLambdaHandler } from "../src/adapters/lambda.js";

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function scalarConfigurationFrom(html: string): Record<string, unknown> {
  const match = html.match(/data-configuration='([^']+)'/);
  assert.ok(match);
  return JSON.parse(decodeHtmlAttribute(match[1]!));
}

function swaggerConfigurationFrom(html: string): Record<string, unknown> {
  const match = html.match(/SwaggerUIBundle\((\{.*\})\);<\/script>/);
  assert.ok(match);
  return JSON.parse(match[1]!);
}

test("docs HTML escapes untrusted title and spec URL", () => {
  const scalar = scalarHtml({ title: "<img>", specUrl: "/openapi.json?x=<script>" });
  assert.match(scalar, /&lt;img&gt;/);
  assert.match(scalar, /\/openapi\.json\?x=&lt;script&gt;/);
  assert.doesNotMatch(scalar, /<img>/);

  const swagger = swaggerUiHtml({ title: "Docs & API", specUrl: '";alert(1)//' });
  assert.match(swagger, /Docs &amp; API/);
  assert.equal(swaggerConfigurationFrom(swagger).url, '";alert(1)//');
  assert.doesNotMatch(swagger, /<\/script><script>/);
});

test("docs helpers support self-hosted assets and nonce-based scripts", () => {
  const scalar = scalarHtml({
    specUrl: "/openapi.json",
    scriptNonce: "nonce-123",
    assets: { scalarScriptUrl: "/docs-assets/scalar.js" },
  });
  assert.match(scalar, /src="\/docs-assets\/scalar\.js"/);
  assert.match(scalar, /nonce="nonce-123"/);

  const swagger = swaggerUiHtml({
    specUrl: "/openapi.json",
    scriptNonce: "nonce-123",
    assets: {
      swaggerUiCssUrl: "/docs-assets/swagger-ui.css",
      swaggerUiBundleUrl: "/docs-assets/swagger-ui.js",
    },
  });
  assert.match(swagger, /href="\/docs-assets\/swagger-ui\.css"/);
  assert.match(swagger, /src="\/docs-assets\/swagger-ui\.js"/);
  assert.match(swagger, /nonce="nonce-123"/);
});

test("docs helpers escape malicious self-hosted asset URLs", () => {
  const html = swaggerUiHtml({
    specUrl: "/openapi.json",
    assets: {
      swaggerUiCssUrl: `/docs.css" onload="alert(1)`,
      swaggerUiBundleUrl: `/docs.js" onerror="alert(1)`,
    },
  });

  assert.doesNotMatch(html, /onload="alert/);
  assert.doesNotMatch(html, /onerror="alert/);
  assert.match(html, /\/docs\.css&quot; onload=&quot;alert\(1\)/);
  assert.match(html, /\/docs\.js&quot; onerror=&quot;alert\(1\)/);
});

test("scalarHtml emits pinned SRI integrity and crossorigin attributes", () => {
  const html = scalarHtml({
    specUrl: "/openapi.json",
    assets: {
      scalarScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0",
      scalarScriptIntegrity: "sha384-abcDEF123+/456ghiJKL789mnoPQR012stuVWX",
    },
  });
  assert.match(
    html,
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@1\.25\.0" integrity="sha384-abcDEF123\+\/456ghiJKL789mnoPQR012stuVWX" crossorigin="anonymous">/
  );
});

test("swaggerUiHtml emits SRI on both the stylesheet and the bundle", () => {
  const html = swaggerUiHtml({
    specUrl: "/openapi.json",
    assets: {
      swaggerUiCssUrl: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css",
      swaggerUiCssIntegrity: "sha512-cssHASH+/value0123456789ABCDEFabcdef==",
      swaggerUiBundleUrl:
        "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js",
      swaggerUiBundleIntegrity: "sha256-jsHASHvalue0123456789ABCDEFabcdef0=",
      crossOrigin: "use-credentials",
    },
  });
  assert.match(
    html,
    /<link rel="stylesheet" href="[^"]+swagger-ui\.css" integrity="sha512-cssHASH\+\/value0123456789ABCDEFabcdef==" crossorigin="use-credentials" \/>/
  );
  assert.match(
    html,
    /<script src="[^"]+swagger-ui-bundle\.js" integrity="sha256-jsHASHvalue0123456789ABCDEFabcdef0=" crossorigin="use-credentials">/
  );
});

test("swaggerUiHtml persists authorization and forwards JSON configuration safely", () => {
  const html = swaggerUiHtml({
    specUrl: "/openapi.json?x=<tag>",
    configuration: {
      docExpansion: "none",
      filter: true,
      displayRequestDuration: true,
      persistAuthorization: false,
      url: "/ignored.json",
      dom_id: "#ignored",
    } as any,
  });
  const configuration = swaggerConfigurationFrom(html);
  assert.equal(configuration.url, "/openapi.json?x=<tag>");
  assert.equal(configuration.dom_id, "#swagger");
  assert.equal(configuration.persistAuthorization, false);
  assert.equal(configuration.docExpansion, "none");
  assert.equal(configuration.filter, true);
  assert.equal(configuration.displayRequestDuration, true);
  assert.doesNotMatch(html, /<tag>/);

  const defaultHtml = swaggerUiHtml({ specUrl: "/openapi.json" });
  assert.equal(swaggerConfigurationFrom(defaultHtml).persistAuthorization, true);
});

test("docs helpers pin default CDN assets with SRI", () => {
  const scalar = scalarHtml({ specUrl: "/openapi.json" });
  assert.match(scalar, /@scalar\/api-reference@1\.62\.5/);
  assert.ok(
    scalar.includes(
      'integrity="sha384-jVBCKhcCfx34USN27x4iQK1SBNdL/HxKq3KuBAxTS4WPaP5w80K4fjpwB+DezJL5"'
    )
  );
  assert.match(scalar, /crossorigin="anonymous"/);

  const swagger = swaggerUiHtml({ specUrl: "/openapi.json" });
  assert.match(swagger, /swagger-ui-dist@5\.32\.8/);
  assert.ok(
    swagger.includes(
      'integrity="sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT"'
    )
  );
  assert.ok(
    swagger.includes(
      'integrity="sha384-IKpAWwsTL0pcw7/Amtnt2eXF4P1BK64WNuY2E/RG15SWLUW5HXzFuyqCSAr/DP8C"'
    )
  );
  assert.equal((swagger.match(/crossorigin="anonymous"/g) ?? []).length, 2);

  const redoc = redocHtml({ specUrl: "/openapi.json" });
  assert.match(redoc, /redoc@2\.5\.3/);
  assert.ok(
    redoc.includes(
      'integrity="sha384-xiEssMQFSpSfLbzRZCGfxxIM5QDb2DTrU6vyoZdp2sV1L6pmOMy6MpTtUoLbpC96"'
    )
  );

  const custom = scalarHtml({
    specUrl: "/openapi.json",
    assets: { scalarScriptUrl: "/assets/scalar.js" },
  });
  assert.doesNotMatch(custom, /integrity=/);
  assert.doesNotMatch(custom, /crossorigin=/);
});

test("docs helpers support multiple space-separated SRI digests", () => {
  const html = scalarHtml({
    specUrl: "/openapi.json",
    assets: {
      scalarScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.0.0",
      scalarScriptIntegrity: "sha384-AAAA+/0123456789abcdef sha512-BBBB+/0123456789abcdef==",
    },
  });
  assert.match(
    html,
    /integrity="sha384-AAAA\+\/0123456789abcdef sha512-BBBB\+\/0123456789abcdef=="/
  );
});

test("docs helpers reject a malformed SRI integrity value", () => {
  assert.throws(
    () =>
      scalarHtml({
        specUrl: "/openapi.json",
        assets: {
          scalarScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.0.0",
          scalarScriptIntegrity: "md5-notallowed",
        },
      }),
    /Invalid Subresource Integrity value/
  );
  assert.throws(
    () =>
      swaggerUiHtml({
        specUrl: "/openapi.json",
        assets: {
          swaggerUiBundleUrl:
            "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.0.0/swagger-ui-bundle.js",
          swaggerUiBundleIntegrity: "   ",
        },
      }),
    /Invalid Subresource Integrity value/
  );
});

test("redocHtml escapes the title and is immune to </script> breakout in the spec URL", () => {
  const html = redocHtml({
    title: "<img src=x onerror=alert(1)>",
    specUrl: "/openapi.json?x=</script><script>alert(1)</script>",
  });
  // Title flows into an HTML text node, so it is HTML-escaped.
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  // The spec URL is embedded inside an inline <script> via <-escaped JSON, so
  // the injected closing tag cannot terminate the script element.
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
  // The init call is still well-formed.
  assert.match(html, /Redoc\.init\("\/openapi\.json\?x=/);
});

test("redocHtml escapes U+2028 / U+2029 line separators in embedded JSON", () => {
  const lineSep = String.fromCharCode(0x2028);
  const paraSep = String.fromCharCode(0x2029);
  const html = redocHtml({ specUrl: `/openapi.json?a=${lineSep}b=${paraSep}` });
  // The raw separators (illegal in older JS string literals) are replaced...
  assert.doesNotMatch(html, new RegExp(lineSep));
  assert.doesNotMatch(html, new RegExp(paraSep));
  // ...with their escape sequences.
  assert.match(html, /\\u2028/);
  assert.match(html, /\\u2029/);
});

test("redocHtml supports self-hosted assets, a nonce, and forwards configuration", () => {
  const html = redocHtml({
    specUrl: "/openapi.json",
    scriptNonce: "nonce-123",
    assets: { redocScriptUrl: "/docs-assets/redoc.js" },
    configuration: { disableSearch: true, hideDownloadButtons: true },
  });
  assert.match(html, /src="\/docs-assets\/redoc\.js"/);
  assert.match(html, /nonce="nonce-123"/);
  assert.match(
    html,
    /Redoc\.init\("\/openapi\.json",\{"disableSearch":true,"hideDownloadButtons":true\},document\.getElementById\("redoc"\)\)/
  );
});

test("redocHtml emits pinned SRI and rejects a malformed integrity value", () => {
  const html = redocHtml({
    specUrl: "/openapi.json",
    assets: {
      redocScriptUrl: "https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js",
      redocScriptIntegrity: "sha384-abcDEF123+/456ghiJKL789mnoPQR012stuVWX",
    },
  });
  assert.match(
    html,
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/redoc@2\.1\.5\/bundles\/redoc\.standalone\.js" integrity="sha384-abcDEF123\+\/456ghiJKL789mnoPQR012stuVWX" crossorigin="anonymous">/
  );

  assert.throws(
    () =>
      redocHtml({
        specUrl: "/openapi.json",
        assets: { redocScriptIntegrity: "md5-notallowed" },
      }),
    /Invalid Subresource Integrity value/
  );
});

test("docsContentSecurityPolicy adds worker-src blob only when allowBlobWorkers is set", () => {
  const base = docsContentSecurityPolicy();
  assert.doesNotMatch(base, /worker-src/);

  const withWorkers = docsContentSecurityPolicy({ allowBlobWorkers: true });
  assert.match(withWorkers, /worker-src 'self' blob:/);
});

test("scalarHtml serializes custom Scalar UI configuration safely", () => {
  const html = scalarHtml({
    title: "Docs",
    specUrl: "/openapi.json?x=<tag>&ok=1",
    configuration: {
      theme: "mars",
      darkMode: true,
      hideTestRequestButton: true,
      customCss: `:root { --brand-content: "A&B"; }`,
    },
  });
  const configuration = scalarConfigurationFrom(html);
  assert.equal(configuration.url, "/openapi.json?x=<tag>&ok=1");
  assert.equal(configuration.theme, "mars");
  assert.equal(configuration.darkMode, true);
  assert.equal(configuration.hideTestRequestButton, true);
  assert.equal(configuration.customCss, `:root { --brand-content: "A&B"; }`);
  assert.match(html, /data-url="\/openapi\.json\?x=&lt;tag&gt;&amp;ok=1"/);
  assert.doesNotMatch(html, /<tag>/);
});

test("scalarHtml keeps the Daloy spec URL when runtime source fields are present", () => {
  const html = scalarHtml({
    specUrl: "/openapi.json",
    configuration: {
      theme: "kepler",
      content: "{}",
      plugins: [],
      sources: [{ url: "/ignored.json" }],
      spec: { url: "/ignored.json" },
      url: "/ignored.json",
    } as any,
  });
  const configuration = scalarConfigurationFrom(html);
  assert.equal(configuration.url, "/openapi.json");
  assert.equal(configuration.theme, "kepler");
  assert.equal(configuration.content, undefined);
  assert.equal(configuration.plugins, undefined);
  assert.equal(configuration.sources, undefined);
  assert.equal(configuration.spec, undefined);
});

test("htmlResponse sets HTML content type and strict docs headers", async () => {
  const res = htmlResponse("<p>ok</p>");
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy") ?? "", /cdn\.jsdelivr\.net/);
  assert.equal(await res.text(), "<p>ok</p>");
});

test("htmlResponse can emit a self-hosted nonce-based docs CSP", () => {
  const nonce = "nonce-123";
  const res = htmlResponse("<p>ok</p>", {
    assetOrigins: [],
    scriptNonce: nonce,
    allowInlineStyles: false,
  });
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'nonce-nonce-123'/);
  assert.doesNotMatch(csp, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
});

test("htmlResponse forwards allowBlobWorkers for custom Redoc routes", () => {
  const res = htmlResponse("<p>ok</p>", { allowBlobWorkers: true });
  assert.match(res.headers.get("content-security-policy") ?? "", /worker-src 'self' blob:/);
});

test("docsContentSecurityPolicy can target custom asset origins", () => {
  const csp = docsContentSecurityPolicy({
    assetOrigins: ["https://docs.example.com"],
    scriptNonce: "abc",
  });
  assert.match(csp, /script-src 'self' https:\/\/docs\.example\.com 'nonce-abc'/);
  assert.match(csp, /style-src 'self' https:\/\/docs\.example\.com 'unsafe-inline'/);
});

test("docsContentSecurityPolicy can target custom API connect origins", () => {
  const csp = docsContentSecurityPolicy({
    connectOrigins: ["https://api.example.com", "http://localhost:4000"],
  });
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com http:\/\/localhost:4000/);
});

test("docsContentSecurityPolicy omits unsafe-inline scripts when nonce is present", () => {
  const csp = docsContentSecurityPolicy({ scriptNonce: "abc" });
  assert.match(csp, /'nonce-abc'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test("htmlResponse omits CDN origins when asset origins are empty", () => {
  const res = htmlResponse("<p>ok</p>", { assetOrigins: [] });
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.doesNotMatch(csp, /cdn\.jsdelivr\.net/);
});

test("structured logger respects level, child bindings, and string messages", () => {
  const lines: string[] = [];
  const logger = createLogger({
    level: "warn",
    bindings: { app: "test" },
    write: (line) => lines.push(line),
  });
  logger.info("hidden");
  logger.warn({ route: "/x" }, "warned");
  logger.child({ requestId: "r1" }).error("failed");

  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), {
    level: "warn",
    app: "test",
    route: "/x",
    msg: "warned",
    time: JSON.parse(lines[0]!).time,
  });
  const err = JSON.parse(lines[1]!);
  assert.equal(err.level, "error");
  assert.equal(err.app, "test");
  assert.equal(err.requestId, "r1");
  assert.equal(err.msg, "failed");
});

test("structured logger falls back when payload serialization fails", () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "info", write: (line) => lines.push(line) });
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  logger.info(circular, "will not stringify");

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    level: "info",
    time: JSON.parse(lines[0]!).time,
    msg: "<unserializable log>",
  });
});

test("cloudflare and vercel adapters delegate to app.fetch", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const cf = await toCloudflareFetchHandler(app).fetch(new Request("http://test.local/ok"));
  const web = await toWebHandler(app)(new Request("http://test.local/ok"));
  const vercelFetch = await toVercelFetchHandler(app).fetch(new Request("http://test.local/ok"));
  assert.equal(cf.status, 200);
  assert.equal(web.status, 200);
  assert.equal(vercelFetch.status, 200);
  assert.deepEqual(await cf.json(), { ok: true });
  assert.deepEqual(await web.json(), { ok: true });
  assert.deepEqual(await vercelFetch.json(), { ok: true });

  const routes = toRouteHandlers(app);
  assert.deepEqual(Object.keys(routes).sort(), [
    "DELETE",
    "GET",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
  ]);
  const routeRes = await routes.GET(new Request("http://test.local/ok"));
  assert.equal(routeRes.status, 200);
});

test("built-in docs render through Cloudflare and Vercel adapter shapes", async () => {
  const app = new App({
    logger: false,
    docs: true,
    openapi: { info: { title: "Portable Docs", version: "1.0.0" } },
  });
  const request = () => new Request("https://api.example.com/docs");

  const cloudflare = await toCloudflareFetchHandler(app).fetch(request());
  const vercel = await toVercelFetchHandler(app).fetch(request());
  const web = await toWebHandler(app)(request());

  for (const response of [cloudflare, vercel, web]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    const html = await response.text();
    assert.match(html, /Portable Docs/);
    assert.match(html, /@scalar\/api-reference@1\.62\.5/);
    assert.match(html, /integrity="sha384-/);
  }
});

test("bun and deno adapters fail loudly outside their runtimes", () => {
  assert.throws(() => serveBun(new App({ logger: false })), /Bun runtime not detected/);
  assert.throws(() => serveDeno(new App({ logger: false })), /Deno runtime not detected/);
});

test("bun adapter passes modern options through to Bun.serve", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const stopped: boolean[] = [];
  const fakeBun = {
    serve(cfg: Record<string, unknown>) {
      captured.push(cfg);
      return {
        port: typeof cfg.port === "number" ? cfg.port : 0,
        url: new URL("http://127.0.0.1:3000/"),
        stop: (force?: boolean) => stopped.push(force === true),
      };
    },
  };
  const prev = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = fakeBun;
  try {
    const app = new App({ logger: false });
    app.route({
      method: "GET",
      path: "/ok",
      operationId: "bunOk",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: { ok: true } }),
    });
    const handle = serveBun(app, {
      port: 4321,
      idleTimeout: 25,
      development: false,
      unix: "/tmp/daloy.sock",
      tls: { cert: "cert", key: "key" },
    });
    assert.equal(handle.port, 0);
    assert.equal(handle.url?.toString(), "http://127.0.0.1:3000/");
    const cfg = captured[0]!;
    assert.equal(cfg.port, undefined);
    assert.equal(cfg.hostname, undefined);
    assert.equal(cfg.idleTimeout, 25);
    assert.equal(cfg.development, false);
    assert.equal(cfg.unix, "/tmp/daloy.sock");
    assert.deepEqual(cfg.tls, { cert: "cert", key: "key" });
    const fetchFn = cfg.fetch as (req: Request) => Promise<Response>;
    const res = await fetchFn(new Request("http://test.local/ok"));
    assert.equal(res.status, 200);
    const errFn = cfg.error as (err: Error) => Response;
    const errRes = errFn(new Error("boom"));
    assert.equal(errRes.status, 500);
    assert.match(errRes.headers.get("content-type") ?? "", /application\/problem\+json/);
    // The runtime fallback error handler must NOT leak the internal error
    // message to clients (prod-mode redaction parity with the Node adapter).
    const errBody = await errRes.json();
    assert.equal(errBody.detail, undefined);
    assert.ok(!JSON.stringify(errBody).includes("boom"));
    await handle.stop();
    assert.deepEqual(stopped, [true]);
  } finally {
    if (prev === undefined) delete (globalThis as { Bun?: unknown }).Bun;
    else (globalThis as { Bun?: unknown }).Bun = prev;
  }
});

test("deno adapter wires signal-based shutdown and TLS options", async () => {
  const captured: Array<{
    init: Record<string, unknown>;
    handler: (req: Request) => Promise<Response>;
  }> = [];
  const signalListeners: Array<{ sig: string; fn: () => void }> = [];
  const removedSignalListeners: Array<{ sig: string; fn: () => void }> = [];
  let shutdownCalls = 0;
  const fakeDeno = {
    serve(init: Record<string, unknown>, handler: (req: Request) => Promise<Response>) {
      captured.push({ init, handler });
      return {
        shutdown: async () => {
          shutdownCalls += 1;
        },
      };
    },
    addSignalListener(sig: string, fn: () => void) {
      signalListeners.push({ sig, fn });
    },
    removeSignalListener(sig: string, fn: () => void) {
      removedSignalListeners.push({ sig, fn });
    },
  };
  const prev = (globalThis as { Deno?: unknown }).Deno;
  (globalThis as { Deno?: unknown }).Deno = fakeDeno;
  try {
    const app = new App({ logger: false });
    app.route({
      method: "GET",
      path: "/ok",
      operationId: "denoOk",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: { ok: true } }),
    });
    const onError = () => new Response("err", { status: 500 });
    const onListen = () => {};
    const externalAbort = new AbortController();
    const handle = serveDeno(app, {
      port: 7000,
      cert: "cert",
      key: "key",
      onListen,
      onError,
      signal: externalAbort.signal,
    });
    const first = captured[0]!;
    assert.equal(first.init.port, 7000);
    assert.equal(first.init.cert, "cert");
    assert.equal(first.init.key, "key");
    assert.equal(first.init.onListen, onListen);
    assert.equal(first.init.onError, onError);
    const sig = first.init.signal as AbortSignal;
    assert.equal(sig.aborted, false);
    const proxiedRes = await first.handler(new Request("http://test.local/ok"));
    assert.equal(proxiedRes.status, 200);
    assert.equal(signalListeners.length, 2);
    await handle.shutdown();
    signalListeners[0]!.fn(); // after shutdown this is a no-op, but still must not throw
    assert.equal(shutdownCalls, 1);
    assert.equal(sig.aborted, true);
    assert.deepEqual(removedSignalListeners.map((x) => x.sig).sort(), ["SIGINT", "SIGTERM"]);
  } finally {
    if (prev === undefined) delete (globalThis as { Deno?: unknown }).Deno;
    else (globalThis as { Deno?: unknown }).Deno = prev;
  }
});

test("fastly adapter delegates to app.fetch and installs a fetch listener", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "fastlyOk",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const handler = toFastlyHandler(app);
  const res = await handler(new Request("http://test.local/ok"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const captured: Array<{
    type: string;
    listener: (event: { request: Request; respondWith: (r: Promise<Response>) => void }) => void;
  }> = [];
  const fakeGlobal = {
    addEventListener(
      type: string,
      listener: (event: { request: Request; respondWith: (r: Promise<Response>) => void }) => void
    ) {
      captured.push({ type, listener });
    },
  };
  const prev = (globalThis as any).addEventListener;
  (globalThis as any).addEventListener = fakeGlobal.addEventListener;
  try {
    installFastlyListener(app);
  } finally {
    if (prev) (globalThis as any).addEventListener = prev;
    else delete (globalThis as any).addEventListener;
  }
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.type, "fetch");

  let captured2: Response | undefined;
  await new Promise<void>((resolve) => {
    captured[0]!.listener({
      request: new Request("http://test.local/ok"),
      respondWith: (p) => {
        void Promise.resolve(p).then((r) => {
          captured2 = r;
          resolve();
        });
      },
    });
  });
  assert.equal(captured2?.status, 200);
});

test("installFastlyListener throws when addEventListener is missing", () => {
  const prev = (globalThis as any).addEventListener;
  delete (globalThis as any).addEventListener;
  try {
    assert.throws(
      () => installFastlyListener(new App({ logger: false })),
      /Fastly Compute runtime not detected/
    );
  } finally {
    if (prev) (globalThis as any).addEventListener = prev;
  }
});

test("lambda adapter converts API Gateway v2 events to Request and back", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "lambdaEcho",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => {
      const cookie = ctx.request.headers.get("cookie") ?? "";
      const text = await ctx.request.text();
      return {
        status: 200 as const,
        headers: { "set-cookie": "a=1; Path=/" },
        body: { received: text ? JSON.parse(text) : null, cookie },
      };
    },
  });

  const handler = toLambdaHandler(app);
  const jsonResult = await handler({
    version: "2.0",
    rawPath: "/echo",
    rawQueryString: "x=1",
    headers: { "content-type": "application/json", host: "api.example.com" },
    cookies: ["s=abc", "u=alice"],
    requestContext: { http: { method: "POST" }, domainName: "api.example.com" },
    body: JSON.stringify({ hello: "world" }),
    isBase64Encoded: false,
  });
  assert.equal(jsonResult.statusCode, 200);
  assert.equal(jsonResult.isBase64Encoded, false);
  assert.deepEqual(jsonResult.cookies, ["a=1; Path=/"]);
  assert.equal(jsonResult.headers["set-cookie"], undefined);
  const parsed = JSON.parse(jsonResult.body);
  assert.deepEqual(parsed.received, { hello: "world" });
  assert.equal(parsed.cookie, "s=abc; u=alice");

  // Base64-encoded request body round-trips through atob.
  const b64Body = Buffer.from(JSON.stringify({ hello: "b64" })).toString("base64");
  const b64Result = await handler({
    version: "2.0",
    rawPath: "/echo",
    headers: { "content-type": "application/json" },
    requestContext: { http: { method: "POST" } },
    body: b64Body,
    isBase64Encoded: true,
  });
  assert.equal(b64Result.statusCode, 200);
  assert.equal(JSON.parse(b64Result.body).received.hello, "b64");
});

test("lambda adapter supports API Gateway v1 and Netlify-style events", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/search",
    operationId: "lambdaV1Search",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => ({
      status: 200 as const,
      headers: { "set-cookie": "legacy=1; Path=/" },
      body: {
        url: ctx.request.url,
        cookie: ctx.request.headers.get("cookie"),
      },
    }),
  });
  app.route({
    method: "POST",
    path: "/legacy-echo",
    operationId: "lambdaV1Echo",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => ({
      status: 200 as const,
      body: { text: await ctx.request.text() },
    }),
  });

  const handler = toLambdaHandler(app);
  const multiValueResult = await handler({
    path: "search",
    httpMethod: "GET",
    headers: { Host: "legacy.example.com", "X-Forwarded-Proto": "http" },
    multiValueHeaders: { cookie: ["s=abc", "u=alice"] },
    multiValueQueryStringParameters: { tag: ["a", "b"], q: ["hello world"] },
  });

  assert.equal(multiValueResult.statusCode, 200);
  assert.equal(multiValueResult.isBase64Encoded, false);
  assert.deepEqual(multiValueResult.multiValueHeaders, { "set-cookie": ["legacy=1; Path=/"] });
  const multiValueBody = JSON.parse(multiValueResult.body);
  assert.equal(multiValueBody.url, "http://legacy.example.com/search?tag=a&tag=b&q=hello+world");
  assert.equal(multiValueBody.cookie, "s=abc; u=alice");

  const singleValueResult = await handler({
    requestContext: { domainName: "context.example.com", path: "/search" },
    httpMethod: "GET",
    queryStringParameters: { q: "one", skip: undefined },
  });
  assert.equal(JSON.parse(singleValueResult.body).url, "https://context.example.com/search?q=one");

  const legacyEchoResult = await handler({
    path: "/legacy-echo",
    httpMethod: "POST",
    body: Buffer.from("legacy body").toString("base64"),
    isBase64Encoded: true,
  });
  assert.deepEqual(JSON.parse(legacyEchoResult.body), { text: "legacy body" });
});

test("lambda adapter preserves a set-cookie header without Headers.getSetCookie", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/cookie",
    operationId: "lambdaCookieFallback",
    responses: { 200: { description: "ok" } },
    handler: async () => ({
      status: 200 as const,
      headers: { "set-cookie": "fallback=1; Path=/" },
      body: { ok: true },
    }),
  });

  const headersPrototype = Headers.prototype as Headers & { getSetCookie?: () => string[] };
  const previousGetSetCookie = headersPrototype.getSetCookie;
  Object.defineProperty(headersPrototype, "getSetCookie", { configurable: true, value: undefined });
  try {
    const result = await toLambdaHandler(app)({
      version: "2.0",
      rawPath: "/cookie",
      requestContext: { http: { method: "GET" } },
    });
    assert.deepEqual(result.cookies, ["fallback=1; Path=/"]);
  } finally {
    if (previousGetSetCookie) {
      Object.defineProperty(headersPrototype, "getSetCookie", {
        configurable: true,
        value: previousGetSetCookie,
      });
    } else {
      delete (headersPrototype as { getSetCookie?: unknown }).getSetCookie;
    }
  }
});

test("lambda adapter base64-encodes binary responses and handles GET defaults", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/png",
    operationId: "lambdaPng",
    responses: { 200: { description: "binary" } },
    handler: async () => ({
      status: 200 as const,
      headers: { "content-type": "image/png" },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }),
  });
  app.route({
    method: "GET",
    path: "/empty",
    operationId: "lambdaEmpty",
    responses: { 204: { description: "empty" } },
    handler: async () => ({ status: 204 as const, body: undefined }),
  });

  const handler = toLambdaHandler(app);

  // Defaults: no method/path/host supplied — adapter falls back to GET "/" host "localhost".
  const fallback = await handler({});
  assert.equal(fallback.statusCode, 404);

  const png = await handler({
    rawPath: "/png",
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(png.statusCode, 200);
  assert.equal(png.isBase64Encoded, true);
  assert.equal(Buffer.from(png.body, "base64").toString("hex"), "89504e47");
  assert.equal(png.cookies, undefined);

  const empty = await handler({
    rawPath: "/empty",
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(empty.statusCode, 204);
  assert.equal(empty.body, "");
  assert.equal(empty.isBase64Encoded, false);

  const emptyFromContextPath = await handler({
    version: "2.0",
    requestContext: { http: { method: "GET", path: "/empty" } },
  });
  assert.equal(emptyFromContextPath.statusCode, 204);
});

test("lambda adapter detects v2 via rawQueryString and falls back to GET / when method and path are absent", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/",
    operationId: "lambdaRoot",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => ({ status: 200 as const, body: { url: ctx.request.url } }),
  });

  // Event has neither `version`, `rawPath`, nor `requestContext.http`; the
  // presence of `rawQueryString` alone marks it v2. With no method/path the
  // adapter must fall back to GET, "/" and host "localhost".
  const result = await toLambdaHandler(app)({ rawQueryString: "q=1" });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).url, "https://localhost/?q=1");
});
