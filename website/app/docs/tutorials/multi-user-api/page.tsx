import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tutorial: build a multi-user API without BOLA",
  description:
    "Build a DaloyJS projects API that prevents cross-user access. Connect a provider-neutral principal to owner-scoped repository operations and prove isolation with adversarial tests.",
  path: "/docs/tutorials/multi-user-api",
  keywords: [
    "DaloyJS authorization tutorial",
    "TypeScript BOLA tutorial",
    "IDOR prevention tutorial",
    "multi user REST API",
    "resource ownership API",
    "cross user authorization tests",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Tutorial: build a multi-user API without BOLA</h1>
      <p>
        We will build a small projects API where Alice and Bob use the same
        endpoints but can access only their own records. The authentication
        adapter and repository are deliberately replaceable. Swap the demo token
        verifier for any identity provider and swap the in-memory repository for
        any database without changing the authorization policy.
      </p>

      <FlowDiagram
        title="What this tutorial proves"
        numbered
        steps={[
          {
            label: "Verify identity",
            detail: "token to Principal",
          },
          {
            label: "Check function",
            detail: "projects:read/write",
          },
          {
            label: "Scope repository",
            detail: "id + principal.userId",
            tone: "accent",
          },
          {
            label: "Attack it",
            detail: "Alice requests Bob's id",
            tone: "danger",
          },
          {
            label: "Fail closed",
            detail: "404 + no data leak",
            tone: "success",
          },
        ]}
        caption="The important test is not whether Alice can read a project. It is whether Alice can read Bob's project while holding a completely valid token."
      />

      <h2 id="1-scaffold">1. Scaffold the project</h2>
      <CodeBlock
        language="bash"
        code={`mkdir multi-user-projects && cd multi-user-projects
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript tsx @types/node`}
      />
      <CodeBlock
        language="json"
        code={`// package.json
{
  "name": "multi-user-projects",
  "type": "module",
  "scripts": {
    "dev": "node --import tsx --watch src/server.ts",
    "test": "node --import tsx --test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  }
}`}
      />

      <h2 id="2-normalize-identity">
        2. Normalize identity into an application principal
      </h2>
      <p>
        Your identity provider verifies login and issues a token or session. The
        backend adapter converts that provider-specific identity into one
        application principal. Authorization code below this boundary should not
        care which provider produced it.
      </p>
      <CodeBlock
        language="ts"
        code={`// src/auth.ts
import {
  App,
  ForbiddenError,
  UnauthorizedError,
  type Hooks,
} from "@daloyjs/core";

export interface Principal {
  userId: string;
  issuer: string;
  subject: string;
  permissions: readonly string[];
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export function authPlugin(verifier: TokenVerifier) {
  return {
    name: "auth",
    register(app: App) {
      app.decorate("verifier", verifier);
    },
  };
}

export function requireAuth(...required: string[]): Hooks {
  return {
    preBody: async (ctx) => {
      const header = ctx.request.headers.get("authorization") ?? "";
      const [scheme, token] = header.split(" ");

      if (scheme?.toLowerCase() !== "bearer" || !token) {
        throw new UnauthorizedError("Missing bearer token");
      }

      let principal: Principal;
      try {
        principal = await ctx.state.verifier.verify(token);
      } catch {
        throw new UnauthorizedError("Invalid or expired token");
      }

      if (
        required.some(
          (permission) => !principal.permissions.includes(permission),
        )
      ) {
        throw new ForbiddenError("Insufficient permission");
      }

      ctx.state.principal = principal;
    },
  };
}

declare module "@daloyjs/core" {
  interface AppState {
    verifier: TokenVerifier;
    principal?: Principal;
  }
}`}
      />
      <p>
        In production, the verifier validates a JWT or session and maps the
        external <code>(issuer, subject)</code> pair to an immutable internal
        <code>userId</code>
        {". "}Do not use email as the ownership key.
      </p>
      <p>
        For this tutorial, use deterministic test identities. These tokens are
        fixtures, not an authentication design:
      </p>
      <CodeBlock
        language="ts"
        code={`// src/test-identities.ts
import type { Principal, TokenVerifier } from "./auth.ts";

const principals = new Map<string, Principal>([
  [
    "alice-token",
    {
      userId: "user-alice",
      issuer: "https://identity.example.test/",
      subject: "alice",
      permissions: ["projects:read", "projects:write"],
    },
  ],
  [
    "bob-token",
    {
      userId: "user-bob",
      issuer: "https://identity.example.test/",
      subject: "bob",
      permissions: ["projects:read", "projects:write"],
    },
  ],
  [
    "reader-token",
    {
      userId: "user-reader",
      issuer: "https://identity.example.test/",
      subject: "reader",
      permissions: ["projects:read"],
    },
  ],
]);

export const demoVerifier: TokenVerifier = {
  async verify(token) {
    const principal = principals.get(token);
    if (!principal) throw new Error("invalid token");
    return principal;
  },
};`}
      />

      <h2 id="3-owner-scoped-repository">
        3. Make the repository owner-scoped
      </h2>
      <p>
        This interface has no ordinary request-path <code>findById()</code>
        {". "}
        Every operation that touches an existing project requires the trusted
        owner ID:
      </p>
      <CodeBlock
        language="ts"
        code={`// src/projects.ts
export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
}

export type CreateProject = {
  name: string;
  description?: string | null;
};

export type ProjectPatch = {
  name?: string;
  description?: string | null;
};

export interface ProjectRepository {
  listForOwner(ownerId: string): Promise<Project[]>;
  findForOwner(id: string, ownerId: string): Promise<Project | null>;
  createForOwner(ownerId: string, input: CreateProject): Promise<Project>;
  updateForOwner(
    id: string,
    ownerId: string,
    patch: ProjectPatch,
  ): Promise<Project | null>;
  deleteForOwner(id: string, ownerId: string): Promise<boolean>;
}

export function createMemoryProjectRepository(): ProjectRepository {
  const rows = new Map<string, Project>([
    [
      "alice-1",
      {
        id: "alice-1",
        ownerId: "user-alice",
        name: "Alice private roadmap",
        description: null,
      },
    ],
    [
      "bob-1",
      {
        id: "bob-1",
        ownerId: "user-bob",
        name: "Bob private launch",
        description: null,
      },
    ],
  ]);
  let nextId = 1;

  return {
    async listForOwner(ownerId) {
      return [...rows.values()].filter((row) => row.ownerId === ownerId);
    },

    async findForOwner(id, ownerId) {
      const row = rows.get(id);
      return row?.ownerId === ownerId ? row : null;
    },

    async createForOwner(ownerId, input) {
      const project: Project = {
        id: \`project-\${nextId++}\`,
        ownerId,
        name: input.name,
        description: input.description ?? null,
      };
      rows.set(project.id, project);
      return project;
    },

    async updateForOwner(id, ownerId, patch) {
      const current = rows.get(id);
      if (!current || current.ownerId !== ownerId) return null;
      const updated = { ...current, ...patch };
      rows.set(id, updated);
      return updated;
    },

    async deleteForOwner(id, ownerId) {
      const current = rows.get(id);
      if (!current || current.ownerId !== ownerId) return false;
      return rows.delete(id);
    },
  };
}`}
      />
      <p>
        A real repository should put <code>id</code> and <code>ownerId</code> in
        the same database query or write condition. Do not load the row by ID
        and hope every caller remembers a separate ownership check.
      </p>

      <h2 id="4-build-routes">4. Build routes that cannot choose an owner</h2>
      <p>
        Request schemas expose only ordinary editable properties. Ownership
        comes from <code>state.principal</code>
        {", "}and response schemas omit the internal ownership key:
      </p>
      <CodeBlock
        language="ts"
        code={`// src/build-app.ts
import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";
import { authPlugin, requireAuth } from "./auth.ts";
import {
  createMemoryProjectRepository,
  type Project,
  type ProjectRepository,
} from "./projects.ts";
import { demoVerifier } from "./test-identities.ts";

const ProjectResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  })
  .strict();

const CreateProjectBody = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

const UpdateProjectBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

function toResponse(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
  };
}

export function buildApp(
  projects: ProjectRepository = createMemoryProjectRepository(),
) {
  const app = new App({
    bodyLimitBytes: 64 * 1024,
    requestTimeoutMs: 5_000,
  });

  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));
  app.register(authPlugin(demoVerifier));
  app.decorate("projects", projects);

  app.get(
    "/projects",
    {
      operationId: "listProjects",
      hooks: requireAuth("projects:read"),
      responses: {
        200: {
          description: "Projects owned by the caller",
          body: z.array(ProjectResponse),
        },
        401: { description: "Authentication required" },
        403: { description: "Missing permission" },
      },
    },
    async ({ state }) => {
      const rows = await state.projects.listForOwner(
        state.principal!.userId,
      );
      return { status: 200, body: rows.map(toResponse) };
    },
  );

  app.get(
    "/projects/:id",
    {
      operationId: "getProject",
      hooks: requireAuth("projects:read"),
      request: {
        params: z.object({ id: z.string().min(1) }).strict(),
      },
      responses: {
        200: { description: "Project", body: ProjectResponse },
        401: { description: "Authentication required" },
        403: { description: "Missing permission" },
        404: { description: "Not found or not accessible" },
      },
    },
    async ({ params, state }) => {
      const project = await state.projects.findForOwner(
        params.id,
        state.principal!.userId,
      );
      if (!project) throw new NotFoundError("Project not found");
      return { status: 200, body: toResponse(project) };
    },
  );

  app.post(
    "/projects",
    {
      operationId: "createProject",
      hooks: requireAuth("projects:write"),
      request: { body: CreateProjectBody },
      responses: {
        201: { description: "Created", body: ProjectResponse },
        401: { description: "Authentication required" },
        403: { description: "Missing permission" },
        422: { description: "Invalid body" },
      },
    },
    async ({ body, state }) => {
      const project = await state.projects.createForOwner(
        state.principal!.userId,
        body,
      );
      return { status: 201, body: toResponse(project) };
    },
  );

  app.patch(
    "/projects/:id",
    {
      operationId: "updateProject",
      hooks: requireAuth("projects:write"),
      request: {
        params: z.object({ id: z.string().min(1) }).strict(),
        body: UpdateProjectBody,
      },
      responses: {
        200: { description: "Updated", body: ProjectResponse },
        401: { description: "Authentication required" },
        403: { description: "Missing permission" },
        404: { description: "Not found or not accessible" },
        422: { description: "Invalid body" },
      },
    },
    async ({ params, body, state }) => {
      const project = await state.projects.updateForOwner(
        params.id,
        state.principal!.userId,
        body,
      );
      if (!project) throw new NotFoundError("Project not found");
      return { status: 200, body: toResponse(project) };
    },
  );

  app.delete(
    "/projects/:id",
    {
      operationId: "deleteProject",
      hooks: requireAuth("projects:write"),
      request: {
        params: z.object({ id: z.string().min(1) }).strict(),
      },
      responses: {
        204: { description: "Deleted" },
        401: { description: "Authentication required" },
        403: { description: "Missing permission" },
        404: { description: "Not found or not accessible" },
      },
    },
    async ({ params, state }) => {
      const deleted = await state.projects.deleteForOwner(
        params.id,
        state.principal!.userId,
      );
      if (!deleted) throw new NotFoundError("Project not found");
      return { status: 204, body: undefined };
    },
  );

  return app;
}

declare module "@daloyjs/core" {
  interface AppState {
    projects: ProjectRepository;
  }
}`}
      />

      <h2 id="5-serve">5. Serve the application</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { buildApp } from "./build-app.ts";

const app = buildApp();
await app.ready();
const { port } = serve(app, { port: 3000 });
console.log(\`listening on http://localhost:\${port}\`);`}
      />
      <p>
        Alice can read <code>alice-1</code>
        {". "}Changing only the path to <code>bob-1</code> must not turn a
        valid Alice token into access to Bob&apos;s project:
      </p>
      <CodeBlock
        language="bash"
        code={`curl http://localhost:3000/projects/alice-1 \
  -H "authorization: Bearer alice-token"
# 200

curl http://localhost:3000/projects/bob-1 \
  -H "authorization: Bearer alice-token"
# 404`}
      />

      <h2 id="6-adversarial-tests">
        6. Add the tests the happy-path tutorial usually forgets
      </h2>
      <CodeBlock
        language="ts"
        code={`// tests/projects.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/build-app.ts";

function auth(token: string) {
  return { authorization: \`Bearer \${token}\` };
}

test("rejects a request without credentials", async () => {
  const response = await buildApp().request("/projects/alice-1");
  assert.equal(response.status, 401);
});

test("Alice can read Alice's project", async () => {
  const response = await buildApp().request("/projects/alice-1", {
    headers: auth("alice-token"),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "alice-1");
});

test("Alice cannot read Bob's project", async () => {
  const response = await buildApp().request("/projects/bob-1", {
    headers: auth("alice-token"),
  });
  assert.equal(response.status, 404);
});

test("Alice's list contains no Bob projects", async () => {
  const response = await buildApp().request("/projects", {
    headers: auth("alice-token"),
  });
  assert.equal(response.status, 200);

  const projects = (await response.json()) as Array<{ id: string }>;
  assert.deepEqual(
    projects.map((project) => project.id),
    ["alice-1"],
  );
});

test("a read-only principal cannot create a project", async () => {
  const response = await buildApp().request("/projects", {
    method: "POST",
    headers: {
      ...auth("reader-token"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Not allowed" }),
  });
  assert.equal(response.status, 403);
});

test("the client cannot assign ownership", async () => {
  const response = await buildApp().request("/projects", {
    method: "POST",
    headers: {
      ...auth("alice-token"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Ownership injection",
      ownerId: "user-bob",
    }),
  });
  assert.equal(response.status, 422);
});

test("Alice cannot update Bob's project", async () => {
  const response = await buildApp().request("/projects/bob-1", {
    method: "PATCH",
    headers: {
      ...auth("alice-token"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Alice was here" }),
  });
  assert.equal(response.status, 404);
});

test("Alice cannot delete Bob's project", async () => {
  const response = await buildApp().request("/projects/bob-1", {
    method: "DELETE",
    headers: auth("alice-token"),
  });
  assert.equal(response.status, 404);
});`}
      />
      <CodeBlock
        language="bash"
        code={`pnpm typecheck
pnpm test`}
      />

      <h2 id="7-swap-adapters">7. Swap adapters without changing policy</h2>
      <p>
        Replace <code>demoVerifier</code> with your OIDC, JWT, session, or API
        gateway verifier. Replace <code>ProjectRepository</code> with your ORM
        or database adapter. Keep these invariants:
      </p>
      <ul>
        <li>
          The authentication adapter produces a trusted internal{" "}
          <code>userId</code>.
        </li>
        <li>
          Route permissions decide whether the operation may be attempted.
        </li>
        <li>
          Repository operations constrain rows using the principal&apos;s owner
          or tenant identity.
        </li>
        <li>
          Request schemas never accept privileged ownership fields from an
          ordinary caller.
        </li>
        <li>Two-principal tests prove that isolation survives refactors.</li>
      </ul>
      <p>
        For tenant-owned data, add the trusted <code>tenantId</code> to the
        principal and to every repository method. For administrative access,
        create a separate permissioned and audited repository path rather than
        silently removing the owner constraint.
      </p>

      <h2 id="next-steps">Next steps</h2>
      <p>
        Read the complete{" "}
        <Link href={"/docs/security/resource-authorization" as Route}>
          resource authorization guide</Link>
        {", "}then connect the same boundary to{" "}
        <Link href="/docs/auth">your authentication provider</Link>
        {", "}
        <Link href="/docs/orm">your ORM</Link>
        {", "}and <Link href="/docs/multitenancy">your tenancy model</Link>.
      </p>
    </>
  );
}
