import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Resource authorization: prevent BOLA and IDOR",
  description:
    "Protect user-owned and tenant-owned records in DaloyJS APIs. Learn function-level, object-level, and property-level authorization with provider-neutral and database-neutral patterns.",
  path: "/docs/security/resource-authorization",
  keywords: [
    "DaloyJS resource authorization",
    "BOLA prevention",
    "IDOR prevention",
    "object level authorization",
    "broken object level authorization",
    "user owned resources",
    "tenant authorization",
    "TypeScript API authorization",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Resource authorization: prevent BOLA and IDOR</h1>
      <p>
        Authentication proves who called the API. Scopes and roles decide which
        operations that identity may attempt. Resource authorization decides
        whether the caller may act on <em>this particular record</em>
        {". "}A valid token with a valid <code>projects:read</code> scope must
        not let Alice read Bob&apos;s project by changing an ID in the URL.
      </p>
      <p>
        OWASP calls this{" "}
        <strong>Broken Object Level Authorization (BOLA)</strong>
        {". "}It is also commonly called an Insecure Direct Object Reference
        (IDOR). DaloyJS can verify identity, validate identifiers, enforce
        scopes, and carry a typed principal into the handler. Your application
        must still connect that principal to its own ownership rules.
      </p>

      <FlowDiagram
        title="One protected request, four decisions"
        numbered
        steps={[
          {
            eyebrow: "identity",
            label: "Authenticate",
            detail: "issuer + subject",
          },
          {
            eyebrow: "function",
            label: "Check permission",
            detail: "projects:read",
          },
          {
            eyebrow: "object",
            label: "Scope the lookup",
            detail: "id + owner + tenant",
            tone: "accent",
          },
          {
            eyebrow: "property",
            label: "Allow safe fields",
            detail: "name, description",
            tone: "success",
          },
        ]}
        caption="A login screen solves only the first decision. A scope usually solves the second. The data operation and strict schemas must solve the last two."
      />

      <h2 id="three-authorization-layers">The three authorization layers</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Question</th>
              <th>Typical control</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Function-level</td>
              <td>May this caller invoke the operation?</td>
              <td>
                Scope, role, or permission such as <code>projects:write</code>
              </td>
            </tr>
            <tr>
              <td>Object-level</td>
              <td>May this caller access this exact record?</td>
              <td>
                Query constrained by resource ID plus trusted owner or tenant
              </td>
            </tr>
            <tr>
              <td>Property-level</td>
              <td>Which fields may this caller read or change?</td>
              <td>Strict request and response schemas</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        These layers are cumulative. Hiding an Edit button in React is useful
        interface behavior, but it is not authorization. Attackers call the API
        directly.
      </p>

      <h2 id="the-vulnerable-pattern">The vulnerable pattern</h2>
      <p>
        This handler is authenticated and checks a scope. It is still vulnerable
        because the database lookup trusts the caller-controlled identifier by
        itself:
      </p>
      <CodeBlock
        language="ts"
        code={`// Vulnerable: a valid caller can replace the URL id with another user's id.
app.get(
  "/projects/:id",
  {
    hooks: requireAuth("projects:read"),
    request: { params: z.object({ id: z.string().min(1) }).strict() },
    responses: { 200: { description: "Project", body: ProjectResponse } },
  },
  async ({ params, state }) => {
    return state.projects.findById(params.id);
  },
);`}
      />
      <p>
        A valid token does not make every identifier safe. The ID is input, not
        proof of ownership.
      </p>

      <h2 id="principal-contract">Use one provider-neutral principal</h2>
      <p>
        Normalize Auth0, Cognito, Entra ID, Clerk, a self-hosted OIDC provider,
        or a signed session into one application-level principal. Keep the
        provider adapter at the authentication boundary and keep business
        policies independent of it:
      </p>
      <CodeBlock
        language="ts"
        code={`export interface Principal {
  /** Stable application user id, resolved from the external identity. */
  userId: string;
  /** Identity-provider issuer. */
  issuer: string;
  /** Provider subject within that issuer. */
  subject: string;
  /** Optional trusted application tenant. */
  tenantId?: string;
  /** Normalized application permissions. */
  permissions: readonly string[];
}

declare module "@daloyjs/core" {
  interface AppState {
    principal?: Principal;
  }
}`}
      />
      <p>
        Map the pair <code>(issuer, subject)</code> to an internal immutable
        user ID. A subject is unique within its issuer, not necessarily across
        every provider. Do not use an email address as the ownership key:
        addresses can change, aliases can collide, and verification rules differ
        between providers.
      </p>

      <h2 id="repository-boundary">
        Put the ownership requirement in the repository boundary
      </h2>
      <p>
        A repository API that exposes only owner-scoped operations makes the
        intended policy visible to humans and coding agents. Its implementation
        can use Prisma, Drizzle, TypeORM, SQL, MongoDB, DynamoDB, or an
        in-memory test double:
      </p>
      <CodeBlock
        language="ts"
        code={`export type ProjectPatch = {
  name?: string;
  description?: string | null;
};

export interface ProjectRepository {
  listForOwner(ownerId: string, tenantId?: string): Promise<Project[]>;
  findForOwner(
    id: string,
    ownerId: string,
    tenantId?: string,
  ): Promise<Project | null>;
  createForOwner(
    ownerId: string,
    input: { name: string; description?: string | null },
    tenantId?: string,
  ): Promise<Project>;
  updateForOwner(
    id: string,
    ownerId: string,
    patch: ProjectPatch,
    tenantId?: string,
  ): Promise<Project | null>;
  deleteForOwner(
    id: string,
    ownerId: string,
    tenantId?: string,
  ): Promise<boolean>;
}`}
      />
      <p>
        A generic <code>findById()</code> may still exist for trusted internal
        jobs, but ordinary request handlers should not reach for it by default.
        Make the safe operation the easy operation.
      </p>

      <h2 id="safe-crud-patterns">Safe CRUD patterns</h2>

      <h3 id="list-resources">List: scope the query</h3>
      <CodeBlock
        language="ts"
        code={`const principal = state.principal!;
const projects = await state.projects.listForOwner(
  principal.userId,
  principal.tenantId,
);`}
      />
      <p>
        Do not load every row and filter in application memory. The data store
        should never return another owner&apos;s rows to the request path.
      </p>

      <h3 id="read-resource">Read: combine ID and ownership</h3>
      <CodeBlock
        language="ts"
        code={`const principal = state.principal!;
const project = await state.projects.findForOwner(
  params.id,
  principal.userId,
  principal.tenantId,
);

if (!project) throw new NotFoundError("Project not found");`}
      />
      <p>
        Returning the same <code>404</code> for a missing record and an
        inaccessible record avoids confirming that another user&apos;s record
        exists. Use <code>403</code> only when revealing existence is an
        intentional product decision.
      </p>

      <h3 id="create-resource">Create: derive ownership from the principal</h3>
      <CodeBlock
        language="ts"
        code={`const CreateProjectBody = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

// ownerId and tenantId are deliberately absent from the request schema.
const project = await state.projects.createForOwner(
  state.principal!.userId,
  body,
  state.principal!.tenantId,
);`}
      />
      <p>
        The client may suggest a name. It must not select its owner, tenant,
        account role, approval state, or other privileged fields.
      </p>

      <h3 id="update-delete-resource">
        Update and delete: constrain the write itself
      </h3>
      <CodeBlock
        language="ts"
        code={`const updated = await state.projects.updateForOwner(
  params.id,
  state.principal!.userId,
  body,
  state.principal!.tenantId,
);

if (!updated) throw new NotFoundError("Project not found");`}
      />
      <p>
        Prefer a single owner-constrained update or delete. A separate
        &quot;load, check, then mutate by ID&quot; sequence is easier to weaken
        during later refactoring and can introduce a time-of-check to
        time-of-use gap when ownership is mutable.
      </p>

      <h2 id="property-authorization">Authorize fields as well as records</h2>
      <p>
        Object ownership does not make every property writable. Reject
        privileged keys with a strict request schema and declare a response
        schema that omits secrets and internal state:
      </p>
      <CodeBlock
        language="ts"
        code={`const UpdateProjectBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

const ProjectResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  })
  .strict();

// Not writable: ownerId, tenantId, role, createdBy, approvedAt.
// Not returned: internal flags, deletedAt, billing metadata.`}
      />

      <h2 id="tenant-owned-resources">Tenant-owned resources</h2>
      <p>
        Tenant identity and tenant authorization are different. Resolve the
        tenant from a verified claim, membership lookup, trusted subdomain, or
        another non-spoofable source. Then include it in every data operation:
      </p>
      <CodeBlock
        language="ts"
        code={`const invoice = await repository.findOne({
  id: params.id,
  tenantId: principal.tenantId,
  ownerId: principal.userId,
});`}
      />
      <p>
        A caller-supplied <code>x-tenant-id</code> header is not proof of
        membership. See <Link href="/docs/multitenancy">Multitenancy</Link> for
        trusted tenant resolution and per-tenant rate-limit, cache, idempotency,
        and concurrency partitions.
      </p>

      <h2 id="administrator-access">Make administrator bypasses explicit</h2>
      <p>
        Do not hide an administrator bypass inside a repository method named{" "}
        <code>findProject()</code>
        {". "}Give it an explicit policy name, require a separate permission,
        and write an audit event:
      </p>
      <CodeBlock
        language="ts"
        code={`if (principal.permissions.includes("projects:admin")) {
  const project = await projects.findForAdministrator(params.id);
  await audit.write({
    action: "project.admin_read",
    actorId: principal.userId,
    resourceId: params.id,
    requestId: state.requestId,
  });
  return project;
}

return projects.findForOwner(params.id, principal.userId, principal.tenantId);`}
      />

      <h2 id="minimum-tests">The minimum adversarial test matrix</h2>
      <p>
        Use at least two principals. A one-user test suite cannot prove
        isolation:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Expected result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>No credentials</td>
              <td>
                <code>401</code>
              </td>
            </tr>
            <tr>
              <td>Valid principal, missing operation permission</td>
              <td>
                <code>403</code>
              </td>
            </tr>
            <tr>
              <td>Alice reads Alice&apos;s record</td>
              <td>
                <code>200</code>
              </td>
            </tr>
            <tr>
              <td>Alice reads or mutates Bob&apos;s record</td>
              <td>
                <code>404</code>
              </td>
            </tr>
            <tr>
              <td>Alice lists records</td>
              <td>Only Alice&apos;s permitted records</td>
            </tr>
            <tr>
              <td>
                Alice submits Bob&apos;s <code>ownerId</code>
              </td>
              <td>
                <code>422</code> or the field is rejected
              </td>
            </tr>
            <tr>
              <td>Cross-tenant identifier</td>
              <td>
                <code>404</code>
              </td>
            </tr>
            <tr>
              <td>Administrator bypass</td>
              <td>Success plus an audit event</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Continue with the{" "}
        <Link href={"/docs/tutorials/multi-user-api" as Route}>
          multi-user projects API tutorial
        </Link>{" "}
        for a complete provider-neutral, repository-neutral implementation and
        executable Alice-versus-Bob tests.
      </p>

      <h2 id="review-checklist">Review checklist</h2>
      <ul>
        <li>Every protected route has an explicit operation permission.</li>
        <li>
          Every identifier route classifies the resource as public, user-owned,
          tenant-owned, shared, or administrator-only.
        </li>
        <li>
          Ownership and tenant keys come from a trusted principal, never an
          ordinary request body.
        </li>
        <li>
          Read and write operations are constrained in the repository or data
          query, not only after loading the record.
        </li>
        <li>
          Request and response schemas enforce property-level authorization.
        </li>
        <li>
          Cross-user and cross-tenant tests cover reads, writes, lists, and
          deletes.
        </li>
        <li>Privileged bypasses are named, permissioned, and audited.</li>
      </ul>
      <p>
        Also review the{" "}
        <Link href="/docs/security/owasp-api-top-10">
          OWASP API Top 10 mapping</Link>
        {", "}<Link href="/docs/auth">authentication overview</Link>
        {", "}and <Link href="/docs/testing">testing guide</Link>.
      </p>
    </>
  );
}
