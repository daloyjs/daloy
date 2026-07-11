import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../src/index.js";

/** Register an echo WebSocket channel so the AsyncAPI doc has something to show. */
function withChannel(app: App): App {
  app.ws("/chat/:room", {
    acknowledgeUnauthenticated: true,
    allowedOrigins: "same-origin",
    meta: { summary: "Chat room", description: "Echo channel" },
    message(conn, data) {
      conn.send(data as string);
    },
  });
  return app;
}

test("asyncapi is off by default: /asyncapi, /asyncapi.json, /asyncapi.yaml are not registered", async () => {
  const app = withChannel(new App({ logger: false }));
  assert.equal((await app.request("/asyncapi")).status, 404);
  assert.equal((await app.request("/asyncapi.json")).status, 404);
  assert.equal((await app.request("/asyncapi.yaml")).status, 404);
});

test("asyncapi: true mounts the JSON document with the app's WS channels", async () => {
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: true,
      openapi: { info: { title: "Realtime API", version: "2.1.0" } },
    })
  );
  const res = await app.request("/asyncapi.json");
  assert.equal(res.status, 200);
  const doc: any = await res.json();
  assert.equal(doc.asyncapi, "3.0.0");
  assert.equal(doc.info.title, "Realtime API");
  assert.equal(doc.info.version, "2.1.0");
  // The WS route became a channel (address uses AsyncAPI {param} templating).
  const channelAddresses = Object.values(doc.channels ?? {}).map((c: any) => c.address);
  assert.ok(
    channelAddresses.some((a: string) => a === "/chat/{room}"),
    `expected a /chat/{room} channel, got ${JSON.stringify(channelAddresses)}`
  );
});

test("asyncapi: true mounts the YAML document with the right content type", async () => {
  const app = withChannel(new App({ logger: false, asyncapi: true }));
  const res = await app.request("/asyncapi.yaml");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/yaml/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const yaml = await res.text();
  assert.match(yaml, /asyncapi:\s*['"]?3\.0\.0/);
});

test("asyncapi: true mounts an interactive UI loading the AsyncAPI standalone bundle under a strict CSP", async () => {
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: true,
      openapi: { info: { title: "Realtime API", version: "1.0.0" } },
    })
  );
  const res = await app.request("/asyncapi");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  const html = await res.text();
  // Loads the AsyncAPI React standalone bundle + stylesheet from the CDN.
  assert.match(html, /@asyncapi\/react-component@3\.1\.4\/browser\/standalone/);
  assert.match(
    html,
    /@asyncapi\/react-component@3\.1\.4\/styles\/default\.min\.css/,
  );
  // Renders against the served JSON document.
  assert.match(html, /AsyncApiStandalone\.render/);
  assert.match(html, /\/asyncapi\.json/);
  assert.match(html, /<title>Realtime API<\/title>/);
  // Strict CSP allowing the CDN, same posture as the OpenAPI docs UIs.
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /cdn\.jsdelivr\.net/);
  assert.match(csp, /connect-src 'self'/); // the UI fetches the spec
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("asyncapi document and UI appear in the OpenAPI introspection with the AsyncAPI tag", async () => {
  const app = withChannel(new App({ logger: false, asyncapi: true }));
  const ids = app.introspect().map((r) => r.operationId);
  assert.ok(ids.includes("getAsyncAPIDocument"));
  assert.ok(ids.includes("getAsyncAPIDocumentYaml"));
  assert.ok(ids.includes("getAsyncAPIUI"));
});

test("asyncapi: { yamlPath: false } disables only the YAML route", async () => {
  const app = withChannel(new App({ logger: false, asyncapi: { yamlPath: false } }));
  assert.equal((await app.request("/asyncapi.json")).status, 200);
  assert.equal((await app.request("/asyncapi")).status, 200);
  assert.equal((await app.request("/asyncapi.yaml")).status, 404);
});

test("asyncapi object form honors custom paths", async () => {
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: { path: "/events", jsonPath: "/events.json", yamlPath: "/events.yaml" },
    })
  );
  assert.equal((await app.request("/events")).status, 200);
  assert.equal((await app.request("/events.json")).status, 200);
  assert.equal((await app.request("/events.yaml")).status, 200);
  // Defaults are not mounted when overridden.
  assert.equal((await app.request("/asyncapi")).status, 404);
});

test("asyncapi: 'auto' skips mounting in production", async () => {
  // withChannel's WS route already satisfies the production secure-default
  // guards (acknowledgeUnauthenticated + allowedOrigins), so the app boots.
  const app = withChannel(new App({ logger: false, env: "production", asyncapi: "auto" }));
  assert.equal((await app.request("/asyncapi.json")).status, 404);
});

test("asyncapi pins SRI hashes when supplied via assets", async () => {
  const sri = "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: {
        assets: { asyncapiScriptIntegrity: sri, asyncapiStyleIntegrity: sri },
      },
    })
  );
  const html = await (await app.request("/asyncapi")).text();
  assert.match(html, new RegExp(`integrity="${sri}"`));
  assert.match(html, /crossorigin="anonymous"/);
});

test("asyncapi uses version-pinned default assets with exact SRI", async () => {
  const app = withChannel(new App({ logger: false, asyncapi: true }));
  const html = await (await app.request("/asyncapi")).text();

  assert.match(html, /@asyncapi\/react-component@3\.1\.4/);
  assert.ok(
    html.includes(
      'integrity="sha384-ZI+8twyvBIiWAquvsA8HFRvWjFn7l9/JlCHI3sekdQ6s7xK8ZDT6TDQOickRDQ0t"'
    )
  );
  assert.ok(
    html.includes(
      'integrity="sha384-hcBf581bZwhXX8SyfsmPFkODqlIruk2b6gfX+b2WuK+am42GxstWJlJLiosKZoiL"'
    )
  );
});

test("asyncapi derives ws/wss servers from openapi.servers when none are given", async () => {
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: true,
      openapi: {
        info: { title: "Realtime API", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }, { url: "http://localhost:3000" }],
      },
    })
  );
  const doc: any = await (await app.request("/asyncapi.json")).json();
  const servers = Object.values(doc.servers ?? {}) as Array<{ host: string; protocol: string }>;
  // https → wss, http → ws.
  assert.ok(servers.some((s) => s.host === "api.example.com" && s.protocol === "wss"));
  assert.ok(servers.some((s) => s.host === "localhost:3000" && s.protocol === "ws"));
});

test("explicit asyncapi.servers override the openapi-derived ones", async () => {
  const app = withChannel(
    new App({
      logger: false,
      asyncapi: { servers: { prod: { host: "ws.example.com", protocol: "wss" } } },
      openapi: {
        info: { title: "X", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
      },
    })
  );
  const doc: any = await (await app.request("/asyncapi.json")).json();
  assert.deepEqual(Object.keys(doc.servers ?? {}), ["prod"]);
  assert.equal(doc.servers.prod.host, "ws.example.com");
});

test("asyncapi works even with no WS channels (empty channels object)", async () => {
  const app = new App({ logger: false, asyncapi: true });
  const res = await app.request("/asyncapi.json");
  assert.equal(res.status, 200);
  const doc: any = await res.json();
  assert.equal(doc.asyncapi, "3.0.0");
  assert.deepEqual(doc.channels ?? {}, {});
});
