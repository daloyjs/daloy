# Exercise 0: Setup & Hello World

Bootstrap a DaloyJS app that auto-mounts OpenAPI docs and exposes a single health route.

## Requirements

- Create an `App` with `title`, `version`, an `openapi.info` block, and `docs: true`.
- Register one `GET /health` route that returns `{ status: "ok" }`.
- Define a response body schema with Zod so the route shows up in `/openapi.json`.
- Boot the server on port `3000` using the Node adapter.

## Verify

After saving:

```bash
curl http://localhost:3000/health
# → {"status":"ok"}

open http://localhost:3000/docs       # Scalar UI
curl http://localhost:3000/openapi.json | jq '.paths."/health"'
```

You should see the `/health` operation in both the Scalar UI and the JSON spec.

## Discussion Prompt

Many frameworks treat OpenAPI as a plugin you bolt on later, and the spec drifts from the runtime as soon as a developer adds a route in a hurry. What is the smallest configuration change in this exercise that closes that drift?

## Why This Matters

`docs: true` and `openapi.info` are the **only** ceremony required for first-class API docs. Every later exercise — validation, errors, auth, typed-client codegen — flows from the same `app.get(...)` / `app.post(...)` style call. Nothing about your docs setup will change as your app grows.

## Training Resources

- [DaloyJS — Getting Started](https://daloyjs.dev/docs/getting-started)
- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [DaloyJS — Routing](https://daloyjs.dev/docs/routing)
