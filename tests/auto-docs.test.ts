import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, createApp, httpBearerScheme, _resetPackageJsonCacheForTests } from "../src/index.js";
import { scalarHtml } from "../src/docs.js";

function withRoute(app: App): App {
  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string() }) as any },
    responses: {
      200: {
        description: "Found",
        body: z.object({ id: z.string(), title: z.string() }) as any,
      },
    },
    handler: async ({ params }) => ({
      status: 200 as const,
      body: { id: (params as any).id, title: "Test" },
    }),
  });
  return app;
}

test("docs option is off by default: /docs and /openapi.json are not registered", async () => {
  const app = withRoute(new App({ logger: false }));
  const ids = app
    .introspect()
    .map((r) => r.operationId)
    .sort();
  assert.deepEqual(ids, ["getBookById"]);
  const docs = await app.request("/docs");
  assert.equal(docs.status, 404);
  const spec = await app.request("/openapi.json");
  assert.equal(spec.status, 404);
});

test("docs: true mounts /docs (scalar by default) and /openapi.json", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      openapi: { info: { title: "Bookstore API", version: "1.0.0" } },
    })
  );

  const spec = await app.request("/openapi.json");
  assert.equal(spec.status, 200);
  const json: any = await spec.json();
  assert.equal(json.openapi, "3.1.0");
  assert.equal(json.info.title, "Bookstore API");
  assert.equal(json.info.version, "1.0.0");
  // User route appears in the generated spec.
  assert.ok(json.paths["/books/{id}"]);
  // Auto-mounted routes appear too, with the default "Docs" tag.
  assert.ok(json.paths["/openapi.json"]);
  assert.ok(json.paths["/docs"]);
  assert.deepEqual(json.paths["/docs"].get.tags, ["Docs"]);

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  assert.match(docs.headers.get("content-type") ?? "", /^text\/html/);
  // Scalar UI is the default.
  const html = await docs.text();
  assert.match(html, /api-reference/);
  assert.match(html, /Bookstore API/);
  // Strict CSP is applied.
  const csp = docs.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /cdn\.jsdelivr\.net/);
  assert.equal(docs.headers.get("x-content-type-options"), "nosniff");
});

test("docs: { ui: 'swagger' } selects Swagger UI", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { ui: "swagger" },
      title: "Swagger Demo",
      version: "2.0.0",
    })
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /SwaggerUIBundle/);
  assert.match(html, /Swagger Demo/);
  assert.match(html, /"persistAuthorization":true/);
});

test("docs: { ui: 'swagger', swagger } forwards config and allows API server connects", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        ui: "swagger",
        swagger: {
          docExpansion: "none",
          filter: true,
          displayRequestDuration: true,
        },
      },
      openapi: {
        info: { title: "Authorized Swagger Demo", version: "1.0.0" },
        servers: [{ url: "https://api.example.com/v1" }],
        securitySchemes: {
          bearer: httpBearerScheme({ bearerFormat: "JWT" }),
        },
      },
    })
  );
  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    auth: { scheme: "bearer" },
    responses: { 201: { description: "Created" } },
    handler: async () => ({ status: 201 as const, body: undefined }),
  });

  const spec = await app.request("/openapi.json");
  assert.equal(spec.status, 200);
  const json: any = await spec.json();
  assert.deepEqual(json.components.securitySchemes.bearer, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  assert.deepEqual(json.paths["/books"].post.security, [{ bearer: [] }]);

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /"persistAuthorization":true/);
  assert.match(html, /"docExpansion":"none"/);
  assert.match(html, /"filter":true/);
  assert.match(html, /"displayRequestDuration":true/);
  const csp = docs.headers.get("content-security-policy") ?? "";
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com/);
});

test("docs: { ui: 'redoc' } selects Redoc and grants worker-src blob in CSP", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { ui: "redoc" },
      title: "Redoc Demo",
      version: "3.0.0",
    })
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  // Redoc markers + the live spec URL forwarded to Redoc.init.
  assert.match(html, /redoc\.standalone\.js/);
  assert.match(html, /Redoc\.init\("\/openapi\.json"/);
  assert.match(html, /Redoc Demo/);
  // Redoc spawns a blob: Web Worker, so this UI's CSP must allow it.
  const csp = docs.headers.get("content-security-policy") ?? "";
  assert.match(csp, /worker-src 'self' blob:/);
  assert.equal(docs.headers.get("x-content-type-options"), "nosniff");
});

test("docs: { ui: 'redoc', redoc } forwards Redoc configuration to Redoc.init", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        ui: "redoc",
        redoc: {
          disableSearch: true,
          hideDownloadButtons: true,
          theme: { colors: { primary: { main: "#2563eb" } } },
        },
      },
      openapi: { info: { title: "Configured Redoc", version: "1.0.0" } },
    })
  );
  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  // Config is embedded as a raw JS object literal inside the init script
  // (no HTML-attribute escaping, unlike Scalar's data-configuration).
  assert.match(html, /"disableSearch":true/);
  assert.match(html, /"hideDownloadButtons":true/);
  assert.match(html, /"primary":\{"main":"#2563eb"\}/);
});

test("docs: auth launcher renders for Scalar, Swagger UI, and Redoc", async () => {
  for (const ui of ["scalar", "swagger", "redoc"] as const) {
    const app = withRoute(
      new App({
        logger: false,
        docs: {
          ui,
          auth: {
            loginUrl: "/login?provider=auth0",
            label: "Sign in",
            description: "Open Auth0 login",
          },
        },
        openapi: {
          info: { title: `${ui} Auth`, version: "1.0.0" },
          securitySchemes: {
            bearer: httpBearerScheme({ bearerFormat: "JWT" }),
          },
        },
      })
    );

    const docs = await app.request("/docs");
    assert.equal(docs.status, 200);
    const html = await docs.text();
    assert.match(html, /data-daloy-docs-auth/);
    assert.match(html, />Sign in<\/button>/);
    assert.match(html, /Open Auth0 login/);
    assert.match(html, /"loginUrl":"\/login\?provider=auth0"/);
    if (ui === "scalar") {
      assert.match(
        html,
        /&quot;authentication&quot;:\{&quot;preferredSecurityScheme&quot;:&quot;bearer&quot;\}/
      );
    }
  }
});

test("docs: auth launcher refuses executable login URLs", () => {
  assert.throws(
    () =>
      scalarHtml({
        specUrl: "/openapi.json",
        auth: { loginUrl: "javascript:alert(1)" },
      }),
    /docs auth loginUrl must be an http\(s\) or relative URL/
  );
});

test("docs: scalar and swagger UIs keep the tighter CSP without worker-src", async () => {
  for (const ui of ["scalar", "swagger"] as const) {
    const app = withRoute(
      new App({
        logger: false,
        docs: { ui },
        openapi: { info: { title: "T", version: "1" } },
      })
    );
    const csp = (await app.request("/docs")).headers.get("content-security-policy") ?? "";
    assert.doesNotMatch(csp, /worker-src/);
  }
});

test("docs: { scalar } forwards Scalar UI configuration", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        path: "/reference",
        openapiPath: "/reference/openapi.json",
        scalar: {
          theme: "kepler",
          layout: "classic",
          customCss: ":root { --scalar-color-accent: #2563eb; }",
          hideTestRequestButton: true,
        },
      },
      title: "Styled Docs",
      version: "2.0.0",
    })
  );

  const docs = await app.request("/reference");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /data-configuration='/);
  assert.match(html, /&quot;theme&quot;:&quot;kepler&quot;/);
  assert.match(html, /&quot;layout&quot;:&quot;classic&quot;/);
  assert.match(html, /&quot;hideTestRequestButton&quot;:true/);
  assert.match(html, /&quot;url&quot;:&quot;\/reference\/openapi\.json&quot;/);
});

test("docs: scalar selects the first configured security scheme by default", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      openapi: {
        info: { title: "Scalar Auth", version: "1.0.0" },
        securitySchemes: {
          bearer: httpBearerScheme({ bearerFormat: "JWT" }),
        },
      },
    })
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(
    html,
    /&quot;authentication&quot;:\{&quot;preferredSecurityScheme&quot;:&quot;bearer&quot;\}/
  );
});

test("docs: scalar respects an explicit preferred security scheme", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        scalar: {
          authentication: { preferredSecurityScheme: "apiKey" },
        },
      },
      openapi: {
        info: { title: "Scalar Auth", version: "1.0.0" },
        securitySchemes: {
          bearer: httpBearerScheme({ bearerFormat: "JWT" }),
          apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        },
      },
    })
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(
    html,
    /&quot;authentication&quot;:\{&quot;preferredSecurityScheme&quot;:&quot;apiKey&quot;\}/
  );
  assert.doesNotMatch(html, /preferredSecurityScheme&quot;:&quot;bearer/);
});

test("docs: { assets } pins SRI hashes on the auto-mounted docs UI", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: {
        assets: {
          scalarScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0",
          scalarScriptIntegrity: "sha384-abcDEF123+/456ghiJKL789mnoPQR012stuVWX",
        },
      },
      openapi: { info: { title: "Pinned Docs", version: "1.0.0" } },
    })
  );

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(
    html,
    /src="https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@1\.25\.0" integrity="sha384-abcDEF123\+\/456ghiJKL789mnoPQR012stuVWX" crossorigin="anonymous"/
  );
});

test("docs: { path, openapiPath } honours custom mount points", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { path: "/api/docs", openapiPath: "/api/openapi.json" },
      openapi: { info: { title: "Custom", version: "0.1.0" } },
    })
  );

  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);

  const docs = await app.request("/api/docs");
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /\/api\/openapi\.json/);

  const spec = await app.request("/api/openapi.json");
  assert.equal(spec.status, 200);
});

test("docs auto-mount rejects duplicate docs and OpenAPI paths", () => {
  assert.throws(
    () => new App({ logger: false, docs: { path: "/same", openapiPath: "/same" } }),
    /Duplicate route/
  );
});

test("docs auto-mount rejects duplicate OpenAPI JSON and YAML paths", () => {
  assert.throws(
    () =>
      new App({
        logger: false,
        docs: { openapiPath: "/spec", openapiYamlPath: "/spec" },
      }),
    /Duplicate route/
  );
});

test("docs auto-mount rejects later user routes that collide with docs", () => {
  const app = new App({ logger: false, docs: true });
  assert.throws(
    () =>
      app.route({
        method: "GET",
        path: "/docs",
        operationId: "customDocs",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: undefined }),
      }),
    /Duplicate route/
  );
});

test("docs: disabled YAML path returns 404", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { openapiYamlPath: false },
      openapi: { info: { title: "T", version: "1" } },
    })
  );
  assert.equal((await app.request("/openapi.json")).status, 200);
  assert.equal((await app.request("/openapi.yaml")).status, 404);
});

test("docs: false explicitly disables the auto-mount", async () => {
  const app = withRoute(
    new App({ logger: false, docs: false, openapi: { info: { title: "X", version: "1" } } })
  );
  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);
});

test("docs: 'auto' is enabled when production is false", async () => {
  const app = withRoute(new App({ logger: false, docs: "auto", production: false }));
  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
});

test("docs: 'auto' is disabled when production is true", async () => {
  const app = withRoute(new App({ logger: false, docs: "auto", production: true }));
  assert.equal((await app.request("/docs")).status, 404);
  assert.equal((await app.request("/openapi.json")).status, 404);
});

test("docs: { enabled: 'auto' } object form respects production flag", async () => {
  const dev = withRoute(
    new App({
      logger: false,
      docs: { enabled: "auto" },
      production: false,
    })
  );
  assert.equal((await dev.request("/docs")).status, 200);

  const prod = withRoute(
    new App({
      logger: false,
      docs: { enabled: "auto" },
      production: true,
    })
  );
  assert.equal((await prod.request("/docs")).status, 404);
});

test("docs: true with no openapi options falls back to default info", async () => {
  // Stub out cwd to a directory with no package.json so the autofill path
  // returns empty and the hardcoded fallback ("DaloyJS API" / "0.0.0") wins.
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => "/__nonexistent_for_test__";
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const spec = await app.request("/openapi.json");
    const json: any = await spec.json();
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
  }
});

test("docs: package.json name/version autofill info when not explicitly set", async () => {
  // Default cwd is the repo root, so the autofill should pick up
  // `@daloyjs/core` and the current version from this repo's package.json.
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(typeof json.info.title, "string");
    assert.equal(typeof json.info.version, "string");
    assert.notEqual(json.info.title, "DaloyJS API"); // proves autofill ran
    assert.notEqual(json.info.version, "0.0.0");
    assert.match(json.info.title, /daloy/i);
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("docs: explicit openapi.info overrides package.json autofill", async () => {
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(
      new App({
        logger: false,
        docs: true,
        openapi: { info: { title: "Explicit", version: "9.9.9" } },
      })
    );
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "Explicit");
    assert.equal(json.info.version, "9.9.9");
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("docs: top-level title/version override package.json autofill", async () => {
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(
      new App({
        logger: false,
        docs: true,
        title: "Top-Level",
        version: "1.2.3",
      })
    );
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "Top-Level");
    assert.equal(json.info.version, "1.2.3");
  } finally {
    _resetPackageJsonCacheForTests();
  }
});

test("createApp({ docs: true }) behaves identically to new App({ docs: true })", async () => {
  _resetPackageJsonCacheForTests();
  const app = withRoute(
    createApp({
      logger: false,
      docs: true,
      openapi: { info: { title: "Factory", version: "1.0.0" } },
    })
  );
  const res = await app.request("/openapi.json");
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.info.title, "Factory");
  assert.equal(json.info.version, "1.0.0");
  assert.ok(json.paths["/books/{id}"], "user routes are preserved");
});

test("createApp() is exported as a plain factory of App", () => {
  const app = createApp();
  assert.ok(app instanceof App);
});

test("docs: top-level title/version/description flow into the spec info", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      title: "Books",
      version: "3.2.1",
      description: "A library service",
    })
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.info.title, "Books");
  assert.equal(json.info.version, "3.2.1");
  assert.equal(json.info.description, "A library service");
});

test("docs: openapi.info overrides top-level title/version/description", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      title: "Fallback",
      version: "0.0.0",
      openapi: { info: { title: "Override", version: "9.9.9" } },
    })
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.info.title, "Override");
  assert.equal(json.info.version, "9.9.9");
});

test("docs: tags option overrides the default ['Docs'] tag", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { tags: ["Meta"] },
      openapi: { info: { title: "T", version: "1" } },
    })
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.deepEqual(json.paths["/docs"].get.tags, ["Meta"]);
  assert.deepEqual(json.paths["/openapi.json"].get.tags, ["Meta"]);
});

test("docs: empty tags array omits the tags field on auto-mounted ops", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: { tags: [] },
      openapi: { info: { title: "T", version: "1" } },
    })
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.equal(json.paths["/docs"].get.tags, undefined);
  assert.equal(json.paths["/openapi.json"].get.tags, undefined);
});

test("docs auto-mount works inside a group() without duplicate-route errors", () => {
  // The constructor mounts docs on the parent; child apps created by group()
  // must skip the auto-mount so they don't try to re-register the same routes
  // (which would throw "Duplicate route").
  const app = new App({
    logger: false,
    docs: true,
    openapi: { info: { title: "G", version: "1" } },
  });
  assert.doesNotThrow(() => {
    app.group("/v1", { tags: ["v1"] }, (v1) => {
      v1.route({
        method: "GET",
        path: "/ping",
        operationId: "v1ping",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: undefined }),
      });
    });
  });
});

test("docs auto-mount respects the openapi.servers and securitySchemes options", async () => {
  const app = withRoute(
    new App({
      logger: false,
      docs: true,
      openapi: {
        info: { title: "S", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    })
  );
  const json: any = await (await app.request("/openapi.json")).json();
  assert.deepEqual(json.servers, [{ url: "https://api.example.com" }]);
  assert.deepEqual(json.components.securitySchemes, {
    bearerAuth: { type: "http", scheme: "bearer" },
  });
});

test("docs: deno.json autofills info when no package.json is present", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-deno-"));
  writeFileSync(
    join(dir, "deno.json"),
    JSON.stringify({
      name: "my-deno-app",
      version: "4.2.0",
      description: "deno-only project",
    })
  );
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "my-deno-app");
    assert.equal(json.info.version, "4.2.0");
    assert.equal(json.info.description, "deno-only project");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: deno.jsonc autofills info and strips JSONC line + block comments", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-denoc-"));
  writeFileSync(
    join(dir, "deno.jsonc"),
    `{
  // app name
  "name": "jsonc-app",
  /* multi-line
     block comment */
  "version": "1.1.1"
}`
  );
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "jsonc-app");
    assert.equal(json.info.version, "1.1.1");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: deno.json ignores empty-string name/version/description fields", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-empty-"));
  writeFileSync(join(dir, "deno.json"), JSON.stringify({ name: "", version: "", description: "" }));
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    // Empty strings should be ignored, falling back to defaults.
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
    assert.equal(json.info.description, undefined);
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs: malformed manifest is swallowed and returns empty autofill", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "daloy-bad-"));
  writeFileSync(join(dir, "deno.json"), "{ not json");
  const realCwd = process.cwd;
  (process as { cwd: () => string }).cwd = () => dir;
  _resetPackageJsonCacheForTests();
  try {
    const app = withRoute(new App({ logger: false, docs: true }));
    const json: any = await (await app.request("/openapi.json")).json();
    assert.equal(json.info.title, "DaloyJS API");
    assert.equal(json.info.version, "0.0.0");
  } finally {
    (process as { cwd: () => string }).cwd = realCwd;
    _resetPackageJsonCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});
