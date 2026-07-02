import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import {
  apiKeyScheme,
  generateOpenAPI,
  httpBasicScheme,
  httpBearerScheme,
  oauth2Scheme,
  openIdConnectScheme,
  discriminator,
  discriminatedUnion,
  openapiToYAML,
} from "../src/openapi.js";
import { validate } from "../src/schema.js";

test("httpBearerScheme returns the spec object with optional bearerFormat and description", () => {
  assert.deepEqual(httpBearerScheme(), { type: "http", scheme: "bearer" });
  assert.deepEqual(httpBearerScheme({ bearerFormat: "JWT", description: "Token" }), {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Token",
  });
});

test("httpBasicScheme returns the spec object with optional description", () => {
  assert.deepEqual(httpBasicScheme(), { type: "http", scheme: "basic" });
  assert.deepEqual(httpBasicScheme({ description: "Basic" }), {
    type: "http",
    scheme: "basic",
    description: "Basic",
  });
});

test("apiKeyScheme validates inputs and emits the spec object", () => {
  assert.deepEqual(
    apiKeyScheme({ in: "header", name: "X-API-Key", description: "key" }),
    { type: "apiKey", in: "header", name: "X-API-Key", description: "key" }
  );
  assert.deepEqual(apiKeyScheme({ in: "cookie", name: "sid" }), {
    type: "apiKey",
    in: "cookie",
    name: "sid",
  });
  assert.deepEqual(apiKeyScheme({ in: "query", name: "k" }), {
    type: "apiKey",
    in: "query",
    name: "k",
  });
  assert.throws(
    () => apiKeyScheme({ in: "body" as any, name: "x" }),
    /must be one of/
  );
  assert.throws(() => apiKeyScheme({ in: "header", name: "" }), /non-empty string/);
});

test("apiKeyScheme rejects unsupported locations and non-string names", () => {
  assert.throws(
    () => apiKeyScheme({ in: "body" as any, name: "x" }),
    /must be one of/,
  );
  assert.throws(
    () => apiKeyScheme({ in: "query", name: null as any }),
    /non-empty string/,
  );
});

test("oauth2Scheme requires at least one flow and includes description when provided", () => {
  const scheme = oauth2Scheme({
    flows: {
      authorizationCode: {
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        scopes: { "read:books": "Read your books" },
      },
    },
    description: "Books OAuth",
  });
  assert.equal(scheme.type, "oauth2");
  assert.equal(scheme.description, "Books OAuth");
  assert.deepEqual(scheme.flows.authorizationCode?.scopes, { "read:books": "Read your books" });
  assert.throws(() => oauth2Scheme({ flows: {} }), /at least one OAuth2 flow/);
});

test("oauth2Scheme rejects missing or empty flows", () => {
  assert.throws(() => oauth2Scheme({} as any), /at least one OAuth2 flow/);
  assert.throws(
    () => oauth2Scheme({ flows: { implicit: undefined } as any }),
    /at least one OAuth2 flow/,
  );
});

test("openIdConnectScheme validates the URL and emits the spec object", () => {
  assert.deepEqual(
    openIdConnectScheme({
      openIdConnectUrl: "https://issuer.example.com/.well-known/openid-configuration",
      description: "OIDC",
    }),
    {
      type: "openIdConnect",
      openIdConnectUrl: "https://issuer.example.com/.well-known/openid-configuration",
      description: "OIDC",
    }
  );
  assert.deepEqual(
    openIdConnectScheme({ openIdConnectUrl: "https://issuer.example.com/.well-known/openid-configuration" }),
    {
      type: "openIdConnect",
      openIdConnectUrl: "https://issuer.example.com/.well-known/openid-configuration",
    }
  );
  assert.throws(
    () => openIdConnectScheme({ openIdConnectUrl: "" }),
    /non-empty string/
  );
});

test("openIdConnectScheme rejects missing or non-string discovery URLs", () => {
  assert.throws(() => openIdConnectScheme({} as any), /non-empty string/);
  assert.throws(
    () => openIdConnectScheme({ openIdConnectUrl: null as any }),
    /non-empty string/,
  );
});

test("generateOpenAPI accepts builder-produced security schemes", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    auth: { scheme: "bearer" },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const doc: any = generateOpenAPI(app, {
    info: { title: "Test", version: "1.0.0" },
    securitySchemes: {
      bearer: httpBearerScheme({ bearerFormat: "JWT" }),
      apiKey: apiKeyScheme({ in: "header", name: "X-API-Key" }),
    },
  });

  assert.deepEqual(doc.components.securitySchemes.bearer, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  assert.equal(doc.components.securitySchemes.apiKey.name, "X-API-Key");
});

test("generateOpenAPI emits webhooks when provided (single and array forms)", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/health",
    operationId: "health",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const doc: any = generateOpenAPI(app, {
    info: { title: "Webhooks Test", version: "1.0.0" },
    webhooks: {
      bookCreated: {
        method: "POST",
        operationId: "onBookCreated",
        summary: "Book created",
        description: "Fires when a book is created",
        tags: ["Webhooks"],
        deprecated: false,
        request: {
          body: z.object({ id: z.string(), title: z.string() }) as any,
        },
        responses: {
          200: { description: "Acknowledged" },
          410: { description: "Gone" },
        },
        auth: { scheme: "bearer", scopes: ["webhook:receive"] },
      },
      multi: [
        {
          method: "POST",
          operationId: "multiPost",
          responses: { 200: { description: "ok" } },
        },
        {
          method: "DELETE",
          operationId: "multiDelete",
          responses: { 200: { description: "ok" } },
        },
      ],
      empty: [],
    },
  });

  assert.ok(doc.webhooks, "webhooks should be present");
  const created = doc.webhooks.bookCreated.post;
  assert.equal(created.operationId, "onBookCreated");
  assert.equal(created.summary, "Book created");
  assert.deepEqual(created.tags, ["Webhooks"]);
  assert.ok(created.requestBody.content["application/json"].schema);
  assert.equal(created.responses[200].description, "Acknowledged");
  assert.deepEqual(created.security, [{ bearer: ["webhook:receive"] }]);
  // No `path` for webhooks, so no path parameters get emitted.
  assert.equal(created.parameters, undefined);

  assert.ok(doc.webhooks.multi.post);
  assert.ok(doc.webhooks.multi.delete);
  // Empty webhook entries are skipped.
  assert.equal(doc.webhooks.empty, undefined);
});

test("generateOpenAPI omits `webhooks` when none are configured", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const doc: any = generateOpenAPI(app, { info: { title: "T", version: "1" } });
  assert.equal(doc.webhooks, undefined);

  // Empty webhooks map collapses to undefined.
  const doc2: any = generateOpenAPI(app, {
    info: { title: "T", version: "1" },
    webhooks: { onlyEmpty: [] },
  });
  assert.equal(doc2.webhooks, undefined);
});

test("webhook with deprecated flag and no body or auth still serializes", () => {
  const app = new App({ logger: false });
  const doc: any = generateOpenAPI(app, {
    info: { title: "T", version: "1" },
    webhooks: {
      simple: {
        method: "POST",
        deprecated: true,
        responses: { 204: { description: "No Content" } },
      },
    },
  });
  assert.equal(doc.webhooks.simple.post.deprecated, true);
  assert.equal(doc.webhooks.simple.post.requestBody, undefined);
  assert.equal(doc.webhooks.simple.post.security, undefined);
});

test("generateOpenAPI emits route-level callbacks (single op and array forms)", () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/subscribe",
    operationId: "subscribe",
    request: {
      body: z.object({ callbackUrl: z.string().url() }) as any,
    },
    responses: { 201: { description: "Subscribed" } },
    callbacks: {
      onEvent: {
        "{$request.body#/callbackUrl}": {
          method: "POST",
          operationId: "onEventCallback",
          summary: "Event delivered",
          tags: ["Callbacks"],
          request: { body: z.object({ id: z.string() }) as any },
          responses: {
            200: { description: "ack" },
            410: { description: "gone" },
          },
          auth: { scheme: "bearer", scopes: ["events:receive"] },
        },
      },
      onMulti: {
        "{$request.body#/callbackUrl}/x": [
          {
            method: "POST",
            operationId: "multiCbPost",
            responses: { 200: { description: "ok" } },
          },
          {
            method: "DELETE",
            operationId: "multiCbDelete",
            responses: { 200: { description: "ok" } },
          },
        ],
        "{$request.body#/skip}": [],
      },
      // Whole callback collapses to undefined — should be skipped entirely.
      empty: { "{$request.body#/none}": [] },
    },
    handler: async () => ({ status: 201 as const, body: undefined }),
  });

  const doc: any = generateOpenAPI(app, { info: { title: "Cb", version: "1" } });
  const op = doc.paths["/subscribe"].post;
  assert.ok(op.callbacks, "callbacks should be present");

  const onEvent = op.callbacks.onEvent["{$request.body#/callbackUrl}"].post;
  assert.equal(onEvent.operationId, "onEventCallback");
  assert.equal(onEvent.summary, "Event delivered");
  assert.deepEqual(onEvent.tags, ["Callbacks"]);
  assert.ok(onEvent.requestBody.content["application/json"].schema);
  assert.equal(onEvent.responses[410].description, "gone");
  assert.deepEqual(onEvent.security, [{ bearer: ["events:receive"] }]);
  // Callback operations have no path, so no path parameters get emitted.
  assert.equal(onEvent.parameters, undefined);

  const multi = op.callbacks.onMulti["{$request.body#/callbackUrl}/x"];
  assert.ok(multi.post);
  assert.ok(multi.delete);
  // Empty expression entry inside a non-empty callback gets dropped.
  assert.equal(op.callbacks.onMulti["{$request.body#/skip}"], undefined);
  // Fully empty callback gets dropped.
  assert.equal(op.callbacks.empty, undefined);
});

test("generateOpenAPI omits `callbacks` when none are configured", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/no-cb",
    operationId: "noCb",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const doc: any = generateOpenAPI(app, { info: { title: "T", version: "1" } });
  assert.equal(doc.paths["/no-cb"].get.callbacks, undefined);
});

test("webhook-level callbacks are emitted under the webhook operation", () => {
  const app = new App({ logger: false });
  const doc: any = generateOpenAPI(app, {
    info: { title: "T", version: "1" },
    webhooks: {
      orderPlaced: {
        method: "POST",
        operationId: "onOrderPlaced",
        responses: { 200: { description: "ok" } },
        callbacks: {
          shipmentUpdate: {
            "{$request.body#/shipmentUrl}": {
              method: "POST",
              operationId: "onShipmentUpdate",
              responses: { 200: { description: "ok" } },
            },
          },
        },
      },
    },
  });
  const cb =
    doc.webhooks.orderPlaced.post.callbacks.shipmentUpdate[
      "{$request.body#/shipmentUrl}"
    ].post;
  assert.equal(cb.operationId, "onShipmentUpdate");
});

test("discriminator() builds the spec object and validates inputs", () => {
  assert.deepEqual(discriminator("kind"), { propertyName: "kind" });
  assert.deepEqual(
    discriminator("kind", { cat: "#/components/schemas/Cat" }),
    { propertyName: "kind", mapping: { cat: "#/components/schemas/Cat" } }
  );
  assert.throws(() => discriminator(""), /non-empty string/);
  assert.throws(() => discriminator(123 as any), /non-empty string/);
});

test("discriminatedUnion() validates by discriminator and emits oneOf+discriminator JSON Schema", async () => {
  const Cat = z.object({ kind: z.literal("cat"), meow: z.boolean() });
  const Dog = z.object({ kind: z.literal("dog"), bark: z.boolean() });
  const Animal = discriminatedUnion(
    "kind",
    { cat: Cat, dog: Dog },
    { mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" } }
  );

  const ok = await validate(Animal, { kind: "cat", meow: true });
  assert.equal(ok.issues, undefined);
  assert.deepEqual(ok.value, { kind: "cat", meow: true });

  const dogOk = await validate(Animal, { kind: "dog", bark: false });
  assert.equal(dogOk.issues, undefined);

  const badType = await validate(Animal, "not-an-object");
  assert.ok(badType.issues);
  assert.match(badType.issues![0]!.message, /Expected object/);

  const arrBad = await validate(Animal, []);
  assert.ok(arrBad.issues);

  const nullBad = await validate(Animal, null);
  assert.ok(nullBad.issues);

  const missing = await validate(Animal, { meow: true });
  assert.ok(missing.issues);
  assert.match(missing.issues![0]!.message, /must be a string/);

  const unknown = await validate(Animal, { kind: "fish" });
  assert.ok(unknown.issues);
  assert.match(unknown.issues![0]!.message, /Unknown discriminator/);

  // Regression: a discriminator value naming an inherited Object.prototype
  // member must be treated as unknown, NOT resolved to that member (which
  // would slip past the guard and throw a TypeError on `["~standard"]` →
  // unauthenticated 500 / error-log flood). Must return a clean issue.
  for (const evil of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    const res = await validate(Animal, { kind: evil });
    assert.ok(res.issues, `expected issues for inherited key ${evil}`);
    assert.match(res.issues![0]!.message, /Unknown discriminator/, `for ${evil}`);
  }

  // Variant-level failure surfaces from inner schema.
  const variantFail = await validate(Animal, { kind: "cat", meow: "loud" });
  assert.ok(variantFail.issues);

  const json = Animal.toJSONSchema();
  assert.equal(Array.isArray(json.oneOf), true);
  assert.equal(json.oneOf.length, 2);
  assert.deepEqual(json.discriminator, {
    propertyName: "kind",
    mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" },
  });

  // Custom vendor surfaces via Standard Schema metadata.
  const tagged = discriminatedUnion("k", { a: Cat }, { vendor: "custom" });
  assert.equal(tagged["~standard"].vendor, "custom");
});

test("discriminatedUnion() guards against bad configuration", () => {
  assert.throws(
    () => discriminatedUnion("", { a: z.object({}) }),
    /non-empty string/
  );
  assert.throws(
    () => discriminatedUnion("kind", {}),
    /at least one variant/
  );
});

test("discriminatedUnion() integrates with generateOpenAPI through .toJSONSchema()", () => {
  const Cat = z.object({ kind: z.literal("cat"), meow: z.boolean() });
  const Dog = z.object({ kind: z.literal("dog"), bark: z.boolean() });
  const Animal = discriminatedUnion("kind", { cat: Cat, dog: Dog });

  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/animals",
    operationId: "createAnimal",
    request: { body: Animal },
    responses: { 201: { description: "ok", body: Animal } },
    handler: async ({ body }) => ({ status: 201 as const, body }),
  });

  const doc: any = generateOpenAPI(app, { info: { title: "Z", version: "1" } });
  const reqSchema =
    doc.paths["/animals"].post.requestBody.content["application/json"].schema;
  assert.ok(Array.isArray(reqSchema.oneOf));
  assert.equal(reqSchema.discriminator.propertyName, "kind");

  const respSchema =
    doc.paths["/animals"].post.responses[201].content["application/json"].schema;
  assert.ok(Array.isArray(respSchema.oneOf));
});

test("discriminatedUnion() falls back to {} when a variant lacks toJSONSchema and the next variant throws", () => {
  const opaque: any = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => ({ value: { kind: "x" } }),
    },
  };
  const throwing: any = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => ({ value: { kind: "y" } }),
    },
    toJSONSchema() {
      throw new Error("nope");
    },
  };
  const Schema = discriminatedUnion("kind", { x: opaque, y: throwing });
  const json = Schema.toJSONSchema();
  assert.deepEqual(json.oneOf, [{}, {}]);
});

// ---------------------------------------------------------------------------
// openapiToYAML + /openapi.yaml route
// ---------------------------------------------------------------------------

test("openapiToYAML serializes a representative OpenAPI document", () => {
  const doc = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/users/{id}": {
        get: {
          summary: "Get user",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "ok" },
          },
        },
      },
    },
    components: { schemas: {} },
  };
  const yaml = openapiToYAML(doc);
  assert.ok(yaml.startsWith("openapi: 3.1.0\n"));
  assert.match(yaml, /info:\n {2}title: Test\n {2}version: 1\.0\.0\n/);
  assert.match(yaml, /paths:\n {2}\/users\/\{id\}:/);
  assert.match(yaml, /parameters:\n {8}- name: id\n {10}in: path\n/);
  assert.match(yaml, /components:\n {2}schemas: \{\}\n/);
});

test("openapiToYAML quotes reserved words, numerics, and special characters", () => {
  const yaml = openapiToYAML({
    yes: "no",
    one: "1.0",
    hash: "# not a comment",
    empty: "",
    arr: [],
    obj: {},
    nested: [null, true, 42, "ok"],
    nestedArr: [[1, 2]],
    emptyObjInArr: [{}],
    multiline: "line1\nline2",
  });
  assert.match(yaml, /"yes": "no"\n/);
  assert.match(yaml, /one: "1\.0"\n/);
  assert.match(yaml, /hash: "# not a comment"\n/);
  assert.match(yaml, /empty: ""\n/);
  assert.match(yaml, /arr: \[\]\n/);
  assert.match(yaml, /obj: \{\}\n/);
  assert.match(yaml, /nested:\n {2}- null\n {2}- true\n {2}- 42\n {2}- ok\n/);
  assert.match(yaml, /nestedArr:\n {2}-\n {4}- 1\n {4}- 2\n/);
  assert.match(yaml, /emptyObjInArr:\n {2}- \{\}\n/);
  assert.match(yaml, /multiline: "line1\\nline2"\n/);
});

test("openapiToYAML coerces non-finite numbers and exotic scalars", () => {
  const yaml = openapiToYAML({
    nan: Number.NaN,
    inf: Number.POSITIVE_INFINITY,
    ninf: Number.NEGATIVE_INFINITY,
    big: 10n,
    undef: undefined,
    arrScalars: [Number.NaN, undefined, 1n],
  });
  // Non-finite numbers and `undefined` collapse to YAML null.
  assert.match(yaml, /nan: null\n/);
  assert.match(yaml, /inf: null\n/);
  assert.match(yaml, /ninf: null\n/);
  assert.match(yaml, /undef: null\n/);
  // BigInt falls through the typeof-string/number/boolean cases and is
  // String()-coerced + quoted.
  assert.match(yaml, /big: "10"\n/);
  assert.match(yaml, /arrScalars:\n {2}- null\n {2}- null\n {2}- "1"\n/);
});

test("openapiToYAML renders empty objects inline as {}", () => {
  const yaml = openapiToYAML({
    emptyObj: {},
    nested: { alsoEmpty: {} },
  });
  // An object with zero entries collapses to inline ` {}` rather than a
  // dangling empty mapping block.
  assert.match(yaml, /emptyObj: \{\}\n/);
  assert.match(yaml, /nested:\n {2}alsoEmpty: \{\}\n/);
});

test("openapiToYAML renders a top-level scalar document inline", () => {
  // The public type expects a document object, but the emitter's scalar
  // fallback is reachable when a scalar is passed directly. Cast through
  // unknown to exercise that branch.
  const yaml = openapiToYAML("hello" as unknown as Record<string, unknown>);
  assert.equal(yaml, " hello\n");
});

test("App.docs mounts /openapi.yaml alongside /openapi.json by default", async () => {
  const yamlApp = new App({ docs: true });
  const res = await yamlApp.fetch(new Request("http://localhost/openapi.yaml"));
  assert.equal(res.status, 200);
  // Must be text/yaml (not application/yaml) so browsers render inline
  // instead of triggering a file download.
  assert.match(res.headers.get("content-type") ?? "", /^text\/yaml/);
  assert.equal(res.headers.get("content-disposition"), "inline");
  const text = await res.text();
  assert.ok(text.startsWith("openapi: 3.1.0\n"));
  assert.match(text, /info:\n/);
});

test("App.docs with openapiYamlPath: false disables the YAML route", async () => {
  const yamlApp = new App({ docs: { openapiYamlPath: false } });
  const res = await yamlApp.fetch(new Request("http://localhost/openapi.yaml"));
  assert.equal(res.status, 404);
});

test("App.docs honours a custom openapiYamlPath", async () => {
  const yamlApp = new App({
    docs: { openapiYamlPath: "/swagger/v1/swagger.yaml" },
  });
  const res = await yamlApp.fetch(
    new Request("http://localhost/swagger/v1/swagger.yaml"),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/yaml/);
});
