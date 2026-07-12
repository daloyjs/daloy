# Exercise 4 — Step-by-Step

> Goal: declare bearer auth once in the App's OpenAPI config, attach it to `POST /books` so the framework enforces it and the docs advertise it, and verify the lock icon appears in Scalar.

You are editing [`exercise-4.ts`](../exercise-4.ts). Reference: [`solutions/exercise-4-end.ts`](../solutions/exercise-4-end.ts).

---

## Mental model first

Auth on a contract-first framework has three parts:

1. **Declaration** — a `securitySchemes` entry on the OpenAPI config. This is the "what" — there exists a scheme called `bearer` of type HTTP / scheme `bearer`.
2. **Reference** — `auth: { scheme: "bearer" }` on the route. This is the "this route uses that scheme".
3. **Enforcement** — `hooks: bearerAuth({ validate })`. This is the actual runtime check.

You need all three. Skip (1) and the generated client doesn't know to send a token. Skip (2) and Scalar shows no lock icon. Skip (3) and the route is wide open at runtime.

Order of work:

1. Declare the scheme on the App.
2. Add `auth` + `hooks` to the route.
3. Document the 401.
4. Verify lock icon, 401, and 201.

---

## Step 1 — Declare the security scheme

Inside `new App({ openapi: { info: …, /* HERE */ } })`:

```ts
openapi: {
  info: { title: "Workshop API", version: "0.1.0" },
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
},
```

**Why the nested `type: "http", scheme: "bearer"` repetition:** the outer `type: "http"` is the OpenAPI category (HTTP auth, vs API-key, vs OAuth2). The inner `scheme: "bearer"` is the specific HTTP auth scheme (bearer, vs basic, vs digest). They look redundant; they aren't.

**Naming the scheme `bearer`:** the _key_ (`bearer`) is the name we'll reference from the route. You can call it anything — `userAuth`, `internal`, whatever. Pick a name that distinguishes it from other schemes you might add later (e.g. an `apiKey` scheme for service-to-service calls).

---

## Step 2 — Attach the scheme to `POST /books`

Inside the `app.post("/books", { ... })` contract options object, add two new fields above `request`:

```ts
auth: { scheme: "bearer" },
hooks: bearerAuth({ validate: (token) => token === "demo-token" }),
```

**Why both fields:**

- `auth: { scheme: "bearer" }` is the _declaration_ on the operation. It flows into `/openapi.json` as `security: [{ bearer: [] }]` and is what Scalar reads to draw the lock icon.
- `hooks: bearerAuth({ validate })` is the _enforcement_. Without it, the operation is documented as requiring auth but the runtime accepts unauthenticated requests. (That's the worst failure mode — you _think_ the route is protected.)

**Why the imported `bearerAuth` helper instead of a hand-rolled hook:** the helper already:

- Parses the `Authorization` header (correct case-insensitive matching, correct token extraction after `Bearer `).
- Returns a 401 problem+json on missing/malformed headers.
- Uses `timingSafeEqual` style comparison internally — but only if you make `validate` async and return the token's expected canonical form. (See the docs link in `instructions/`.)

---

## Step 3 — Document the 401

The starter already has `401: { description: "Unauthorized" }` in `responses`. Confirm it's there. Without it, the generated TypeScript client thinks the only possible response is 201 and your error-handling code is unreachable.

---

## Step 4 — Verify

```bash
# (a) No token → 401
curl -s -i -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion"}' | head -n 1
# HTTP/1.1 401 Unauthorized

# (b) Correct token → 201
curl -s -i -X POST http://localhost:3000/books \
  -H 'authorization: Bearer demo-token' \
  -H 'content-type: application/json' \
  -d '{"id":"3","title":"Hyperion"}' | head -n 1
# HTTP/1.1 201 Created

# (c) Wrong token → 401
curl -s -X POST http://localhost:3000/books \
  -H 'authorization: Bearer guess' \
  -H 'content-type: application/json' \
  -d '{"id":"4","title":"Ringworld"}'
```

Then open `http://localhost:3000/docs`. You should see a lock icon on `createBook` and an `Authorize` button at the top of the page. Click it, paste `demo-token`, and the in-page "Try it" requests now include the header automatically.

---

## Code-change cheat sheet

| Step | Where                 | Change                                                                              |
| ---- | --------------------- | ----------------------------------------------------------------------------------- |
| 1    | `new App({ openapi })` | Add `securitySchemes: { bearer: { type: "http", scheme: "bearer" } }`              |
| 2    | `POST /books` route    | Add `auth: { scheme: "bearer" }` and `hooks: bearerAuth({ validate })`              |
| 3    | `responses`            | (no change — `401: { description: "Unauthorized" }` was already there)              |

---

## Common mistakes

- **Adding only the `auth` field, not the `hooks`.** Docs say "auth required" — runtime says "come on in". This is the single most dangerous misconfiguration on this page.
- **Using `===` against an env-var-loaded secret.** This is a timing-attack vector. The workshop's `validate` callback uses `===` only because `demo-token` is public knowledge. In production, use `timingSafeEqual`-based comparison — see the [secure-defaults docs](https://daloyjs.dev/docs/security/secure-defaults).
- **Forgetting `securitySchemes` and just adding `auth: { scheme: "bearer" }` on the route.** The route enforces the token at runtime, but the OpenAPI spec has no scheme called `bearer` to reference, so the generated client doesn't know to ask for one. Hilarity ensues.
- **Calling the scheme `Bearer` (capital B) in `securitySchemes` and `bearer` (lowercase) on the route.** Both work in isolation; together they generate a spec with a dangling reference. Pick one casing and stick to it.
