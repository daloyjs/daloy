import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Modular monolith",
  description:
    "Reference folder and file structure for building a scalable modular monolith with DaloyJS, bounded contexts as plugins, a thin shared kernel, contract-driven module boundaries, and a clean path to extract services later.",
  path: "/docs/architecture/modular-monolith",
  keywords: [
    "modular monolith",
    "DaloyJS architecture",
    "bounded context",
    "scalable TypeScript backend",
    "domain driven design folder structure",
    "plugin encapsulation",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Modular monolith</h1>
      <p>
        A modular monolith is one deployable, but inside the codebase each business capability is a
        clearly bounded module. You get the operational simplicity of a monolith and most of the
        decoupling of microservices, without the network, the orchestration, or the early
        commitment.
      </p>
      <p>
        DaloyJS is a great fit for this style because{" "}
        <Link href="/docs/plugins">plugins are encapsulated</Link>, every route is a typed contract,
        and the same{" "}
        <Link href="/docs/openapi">OpenAPI document</Link> + <Link href="/docs/typed-client">typed
        client</Link> you ship to consumers also lets your own modules call each other safely. When
        you eventually extract a module into its own service, the contract is already there.
      </p>

      <h2 id="mental-model">Mental model</h2>
      <ul>
        <li>
          <strong>Module</strong>: one bounded context (e.g. <code>catalog</code>,{" "}
          <code>orders</code>, <code>identity</code>). Owns its routes, domain logic, persistence,
          and tests. Exposes only a public surface.
        </li>
        <li>
          <strong>Shared kernel</strong>: cross-cutting infrastructure (db client, logger, http
          hooks, config). Knows nothing about any specific module.
        </li>
        <li>
          <strong>Platform</strong>: wiring code: which modules to register, in what order, with
          which prefixes. Builds the <code>App</code> and exposes the typed client.
        </li>
      </ul>

      <h2 id="reference-folder-structure">Reference folder structure</h2>
      <p>
        This is the layout we recommend for new projects. <code>create-daloy</code> can scaffold a
        small version of it, and it scales cleanly from one module to dozens.
      </p>
      <CodeBlock
        language="text"
        code={`src/
├── server.ts                # runtime entrypoint (node | edge | bun | deno)
├── app.ts                   # builds the App, calls registerModules(app)
│
├── config/
│   ├── env.ts               # zod-validated process.env
│   └── index.ts
│
├── shared/                  # cross-cutting kernel - NO business logic
│   ├── db/
│   │   └── client.ts        # single ORM, ODM, or query-client instance
│   ├── http/
│   │   ├── errors.ts        # problem+json helpers
│   │   └── hooks.ts         # auth, requestId, rateLimit, secureHeaders
│   ├── observability/
│   │   ├── logger.ts
│   │   └── tracer.ts
│   └── types.ts             # framework-agnostic shared types
│
├── modules/                 # one folder per bounded context
│   ├── catalog/
│   │   ├── index.ts         # the plugin: registers routes + decorators
│   │   ├── routes/
│   │   │   ├── list-books.ts
│   │   │   ├── get-book.ts
│   │   │   └── create-book.ts
│   │   ├── domain/          # pure business rules - no framework imports
│   │   │   ├── book.ts
│   │   │   └── catalog-service.ts
│   │   ├── infra/           # adapters: db, search, external APIs
│   │   │   ├── book-repo.ts
│   │   │   └── search-index.ts
│   │   ├── contracts/
│   │   │   ├── schemas.ts   # zod request/response schemas
│   │   │   └── public.ts    # types other modules may import
│   │   └── catalog.test.ts
│   │
│   ├── orders/
│   │   ├── index.ts
│   │   ├── routes/
│   │   ├── domain/
│   │   ├── infra/
│   │   ├── contracts/
│   │   └── orders.test.ts
│   │
│   └── identity/
│       ├── index.ts
│       ├── routes/
│       ├── domain/
│       ├── infra/
│       └── contracts/
│
├── platform/                # wiring only - no domain logic
│   ├── modules.ts           # ordered list of modules to register
│   ├── openapi.ts           # generateOpenAPI(app) → openapi.json
│   └── client.ts            # in-process typed client wiring
│
└── tests/
    ├── contract/            # OpenAPI-driven contract tests
    └── e2e/                 # full HTTP scenarios per user journey

openapi/                     # generated artifacts checked into VCS
└── openapi.json

generated/                   # Hey API typed client output
└── client/
`}
      />

      <h2 id="module-dependency-rules">Module dependency rules</h2>
      <p>
        The whole point of a modular monolith is that the rules are <em>enforceable</em>, not just
        documented. There are only three rules and a linter can keep you honest.
      </p>
      <LayerStack
        title="Dependency direction"
        caption="Dependencies only ever point downward. app.ts wires the modules; each module may use shared/ and other modules' public contracts; shared/ never reaches back up into a module. The exact allow/forbid rules follow below."
        layers={[
          {
            title: "app.ts",
            detail: "builds the App, registers modules in order",
            tone: "accent",
            items: ["registerModules(app)"],
          },
          {
            title: "modules/",
            detail: "one bounded context per folder",
            items: ["catalog", "orders", "identity"],
          },
          {
            title: "shared/",
            detail: "cross-cutting kernel, no business logic",
            tone: "muted",
            items: ["db", "http", "logger", "config", "types"],
          },
        ]}
      />
      <CodeBlock
        language="text"
        code={`           ┌──────────────────────────────────────────────┐
           │                   app.ts                     │
           │   builds App, registers modules in order     │
           └──────────────────────┬───────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│   catalog    │          │    orders    │          │   identity   │
│   plugin     │          │   plugin     │          │   plugin     │
└──────┬───────┘          └──────┬───────┘          └──────┬───────┘
       │ uses                    │ uses                    │ uses
       ▼                         ▼                         ▼
            ┌──────────────────────────────────────────┐
            │                 shared/                  │
            │   db · http · logger · config · types    │
            └──────────────────────────────────────────┘

  Allowed:   modules/* → shared/*
  Allowed:   modules/* → other-module/contracts/public  (types only)
  Allowed:   modules/* → platform/client (in-process typed client)

  Forbidden: modules/A → modules/B/{domain,infra,routes}
  Forbidden: shared/* → modules/*
  Forbidden: domain/* → infra/* or framework code
`}
      />

      <h2 id="anatomy-of-a-module">Anatomy of a module</h2>
      <p>
        A module is just a DaloyJS plugin. The folder structure is what gives it long-term shape;
        the framework only cares about the <code>register()</code> function in{" "}
        <code>index.ts</code>.
      </p>
      <CodeBlock
        code={`// src/modules/catalog/index.ts
import type { App } from "@daloyjs/core";

import { listBooks }  from "./routes/list-books.ts";
import { getBook }    from "./routes/get-book.ts";
import { createBook } from "./routes/create-book.ts";

import { CatalogService } from "./domain/catalog-service.ts";
import { BookRepo }       from "./infra/book-repo.ts";

export const catalogModule = {
  name: "catalog",
  register(app: App) {
    // Wire the module's own dependencies into a single decorator.
    // Other modules cannot see this - encapsulation is per-plugin.
    app.decorate("catalog", new CatalogService(new BookRepo(app.state.db)));

    listBooks(app);
    getBook(app);
    createBook(app);
  },
};`}
      />
      <p>
        Each route file contains exactly one <code>app.route(...)</code> call. That keeps OpenAPI
        diffs small, makes test scoping obvious, and lets new contributors find the right file from
        an <code>operationId</code> in seconds.
      </p>

      <h2 id="public-contracts-how-modules-talk">Public contracts: how modules talk</h2>
      <p>
        Every module has a <code>contracts/public.ts</code>. It is the only file other modules are
        allowed to import. Treat it like a public package boundary inside your monorepo.
      </p>
      <CodeBlock
        code={`// src/modules/catalog/contracts/public.ts
import { z } from "zod";

export const BookId = z.uuid().brand<"BookId">();
export type BookId = z.infer<typeof BookId>;

export const Book = z.object({
  id: BookId,
  title: z.string(),
  authorId: z.uuid(),
  priceCents: z.number().int().nonnegative(),
});
export type Book = z.infer<typeof Book>;`}
      />
      <p>
        Inside the module, <code>domain/</code> and <code>infra/</code> may use richer internal
        types. Across modules, only the public schema is visible. This is the same pattern that
        makes future extraction painless, the cross-module type surface is already minimal and
        already validated.
      </p>

      <h2 id="cross-module-calls-without-coupling">Cross-module calls without coupling</h2>
      <p>
        When <code>orders</code> needs a book, it does <em>not</em> import <code>BookRepo</code>.
        It calls catalog through the same <Link href="/docs/typed-client">typed client</Link>{" "}
        consumers use, pointed at the in-process app instead of HTTP.
      </p>
      <CodeBlock
        code={`// src/platform/client.ts
import { createInProcessClient } from "@daloyjs/core/client";
import { app } from "@/app";

// Same shape as the public typed client; zero network hops.
export const internal = createInProcessClient(app);`}
      />
      <CodeBlock
        code={`// src/modules/orders/domain/place-order.ts
import { internal } from "@/platform/client";

export async function placeOrder(input: { bookId: string; userId: string }) {
  const { body: book } = await internal.getBook({ params: { id: input.bookId } });

  if (!book) throw new Error("book not found");

  // ... charge, persist, emit event, return order
}`}
      />
      <p>
        Two wins: orders has no compile-time dependency on catalog&apos;s implementation, and the
        day you extract catalog into a separate service, the only change in orders is a base URL.
      </p>

      <h2 id="wiring-modules-into-the-app">Wiring modules into the app</h2>
      <p>
        Keep registration explicit and ordered. A single list is far easier to review than
        auto-discovery, and it makes startup deterministic across runtimes.
      </p>
      <CodeBlock
        code={`// src/platform/modules.ts
import type { App } from "@daloyjs/core";

import { identityModule } from "@/modules/identity";
import { catalogModule }  from "@/modules/catalog";
import { ordersModule }   from "@/modules/orders";

export function registerModules(app: App) {
  app.register(identityModule, { prefix: "/identity", tags: ["Identity"] });
  app.register(catalogModule,  { prefix: "/catalog",  tags: ["Catalog"]  });
  app.register(ordersModule,   { prefix: "/orders",   tags: ["Orders"]   });
}`}
      />
      <CodeBlock
        code={`// src/app.ts
import { App, secureHeaders, rateLimit, requestId } from "@daloyjs/core";

import { env }             from "@/config";
import { registerModules } from "@/platform/modules";
import { openDatabase }    from "@/shared/db/client";
import { createLogger }    from "@/shared/observability/logger";

export const app = new App({ bodyLimitBytes: 1 << 20 });

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 600 })); // global unless you configure keyGenerator or trustProxyHeaders

app.decorate("db",     await openDatabase(env.DATABASE_URL));
app.decorate("logger", createLogger({ level: env.LOG_LEVEL }));

registerModules(app);

await app.ready();`}
      />

      <h2 id="enforcing-boundaries-with-the-linter">Enforcing boundaries with the linter</h2>
      <p>
        Documentation drifts. Tooling does not. Add an{" "}
        <code>eslint-plugin-import</code> rule that bans the patterns the architecture forbids.
      </p>
      <CodeBlock
        language="json"
        code={`// .eslintrc.json (excerpt)
{
  "rules": {
    "import/no-restricted-paths": ["error", {
      "zones": [
        {
          "target": "src/shared",
          "from":   "src/modules",
          "message": "shared/ must not depend on any module"
        },
        {
          "target": "src/modules/*/domain",
          "from":   ["src/modules/*/infra", "src/modules/*/routes"],
          "message": "domain/ must stay framework- and infra-free"
        },
        {
          "target": "src/modules/*/!(contracts)/**",
          "from":   "src/modules/!(self)/!(contracts)/**",
          "message": "cross-module imports are only allowed via contracts/public"
        }
      ]
    }]
  }
}`}
      />

      <h2 id="testing-layout">Testing layout</h2>
      <p>
        Tests follow the module boundary. Each module owns its unit and integration tests; the
        repository keeps a small top-level <code>tests/contract</code> suite that runs against the
        generated OpenAPI document so any unintended schema change fails CI.
      </p>
      <CodeBlock
        language="text"
        code={`src/modules/catalog/catalog.test.ts        # unit + module-level integration
src/modules/orders/orders.test.ts          # unit + module-level integration
tests/contract/openapi.spec.ts             # diff-against-frozen-snapshot
tests/e2e/checkout.e2e.ts                  # cross-module user journeys`}
      />

      <h2 id="scaling-the-monolith">Scaling the monolith</h2>
      <p>
        Most teams never need to leave this layout. When you do, usually because one module needs
        independent scaling, a different runtime, or a separate on-call rotation, the path is
        straightforward.
      </p>
      <ol>
        <li>
          Move <code>src/modules/&lt;name&gt;</code> into its own repo or workspace package and keep
          its plugin entry intact.
        </li>
        <li>
          Re-export <code>contracts/public.ts</code> as a published package so the original repo can
          still import the types.
        </li>
        <li>
          Swap the in-process typed client for a real HTTP base URL in the original repo, the
          callsites do not change.
        </li>
        <li>
          Re-run <code>generateOpenAPI</code> in both repos; the contract-test suite immediately
          tells you if anything drifted.
        </li>
      </ol>
      <p>
        Because every cross-module call already went through a typed contract, extraction becomes a
        configuration change rather than an architectural rewrite.
      </p>

      <h2 id="anti-patterns-to-avoid">Anti-patterns to avoid</h2>
      <ul>
        <li>
          <strong>Reaching into another module&apos;s <code>domain/</code> or <code>infra/</code>.
          </strong>{" "}
          The instant this is allowed, the modules collapse back into a tangle. Keep the lint rule
          enforced.
        </li>
        <li>
          <strong>Putting domain logic in <code>shared/</code>.</strong>{" "}
          <code>shared/</code> is for plumbing only. If you need a helper that knows about{" "}
          <code>Book</code>, it belongs inside <code>modules/catalog</code>.
        </li>
        <li>
          <strong>One giant <code>routes.ts</code> per module.</strong> Prefer one file per route, 
          it keeps OpenAPI diffs reviewable and gives you obvious test boundaries.
        </li>
        <li>
          <strong>Auto-loading modules from the filesystem.</strong> Explicit registration in{" "}
          <code>platform/modules.ts</code> is easier to audit, diff, and reason about across
          runtimes.
        </li>
        <li>
          <strong>Premature service extraction.</strong> Stay a monolith until the operational
          benefit is concrete. The contracts you build along the way are what makes splitting cheap
          later.
        </li>
      </ul>

      <h2 id="where-to-next">Where to next</h2>
      <ul>
        <li>
          <Link href="/docs/plugins">Plugins & encapsulation</Link>: the primitive every module is
          built on.
        </li>
        <li>
          <Link href="/docs/openapi">OpenAPI generation</Link>: the contract that powers the typed
          client and contract tests.
        </li>
        <li>
          <Link href="/docs/typed-client">Typed clients</Link>: how cross-module calls stay
          decoupled.
        </li>
        <li>
          <Link href="/docs/testing">Testing</Link>: pairing module-level tests with
          contract-level guarantees.
        </li>
      </ul>
    </>
  );
}
