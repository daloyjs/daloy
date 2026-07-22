import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "your-jwt-is-valid-and-your-api-is-still-vulnerable",
  title: "Your JWT Is Valid and Your API Is Still Vulnerable",
  description:
    "Login works, the access token is valid, and Alice can still read Bob's data by changing one URL id. This is the resource-authorization gap in AI-generated backends, plus the provider-neutral and database-neutral pattern that closes it.",
  date: "2026-07-17",
  readingTime: "11 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino fullstack developer in Norway. Has spent around 12 years learning that a green login button is not an authorization policy, no matter how confidently the demo presenter clicks it.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "BOLA vulnerability",
    "IDOR vulnerability",
    "AI generated API security",
    "JWT authorization",
    "resource authorization",
    "object level authorization",
    "TypeScript REST API security",
    "cross user access",
    "DaloyJS authorization",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const VULNERABLE_ROUTE = `// The login works. The token is valid. The scope is valid.
// The endpoint is still vulnerable.
app.get(
  "/projects/:id",
  {
    hooks: requireAuth("projects:read"),
    request: { params: z.object({ id: z.string() }).strict() },
    responses: { 200: { description: "Project", body: ProjectResponse } },
  },
  async ({ params, state }) => {
    return state.projects.findById(params.id);
  },
);

// Alice calls /projects/alice-1  -> 200
// Alice calls /projects/bob-1    -> also 200
//
// Authentication passed both times. That is exactly the problem.`;

const PRINCIPAL = `// Every identity provider or session adapter ends here.
// Business code below this boundary stays provider-neutral.
export interface Principal {
  userId: string;               // immutable internal application id
  issuer: string;               // who authenticated the caller
  subject: string;              // provider subject within that issuer
  tenantId?: string;            // trusted application tenant
  permissions: readonly string[];
}

declare module "@daloyjs/core" {
  interface AppState {
    principal?: Principal;
  }
}`;

const SAFE_REPOSITORY = `// Make the safe operation the obvious operation.
export interface ProjectRepository {
  listForOwner(ownerId: string, tenantId?: string): Promise<Project[]>;
  findForOwner(
    id: string,
    ownerId: string,
    tenantId?: string,
  ): Promise<Project | null>;
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
}`;

const SAFE_ROUTE = `app.get(
  "/projects/:id",
  {
    hooks: requireAuth("projects:read"),
    request: {
      params: z.object({ id: z.string().min(1) }).strict(),
    },
    responses: {
      200: { description: "Project", body: ProjectResponse },
      404: { description: "Not found or not accessible" },
    },
  },
  async ({ params, state }) => {
    const principal = state.principal!;
    const project = await state.projects.findForOwner(
      params.id,
      principal.userId,
      principal.tenantId,
    );

    if (!project) throw new NotFoundError("Project not found");
    return { status: 200, body: toProjectResponse(project) };
  },
);`;

const CREATE_ROUTE = `const CreateProjectBody = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

// ownerId, tenantId, role, and approvedAt are not accepted.
// The client describes the project. The principal decides who owns it.
const project = await state.projects.createForOwner(
  state.principal!.userId,
  body,
  state.principal!.tenantId,
);`;

const ATTACK_TESTS = `test("Alice cannot read Bob's project", async () => {
  const response = await app.request("/projects/bob-1", {
    headers: { authorization: "Bearer alice-token" },
  });

  assert.equal(response.status, 404);
});

test("Alice cannot assign a project to Bob", async () => {
  const response = await app.request("/projects", {
    method: "POST",
    headers: {
      authorization: "Bearer alice-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Definitely normal project",
      ownerId: "user-bob",
    }),
  });

  assert.equal(response.status, 422);
});`;

const AGENT_RULE = `When a route accepts a resource identifier:

1. Classify the resource as public, user-owned, tenant-owned, shared,
   or administrator-only.
2. Check the operation permission.
3. Constrain the data read or write with the resource id AND the trusted
   owner or tenant from the verified principal.
4. Never accept ownership or privileged fields from an ordinary body.
5. Add two principals and prove that Alice cannot access Bob's record.
6. Make administrator bypasses explicit, permissioned, and audited.

Do not treat successful authentication as resource authorization.`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: { "@type": "Person", name: POST.author },
  publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/blog/${POST.slug}`,
  },
  url: `${SITE_URL}/blog/${POST.slug}`,
};

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <Link
            href="/blog"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            &lt;- Back to blog
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">BOLA / IDOR</Badge>
            <Badge variant="outline">AI-generated APIs</Badge>
            <Badge variant="outline">Authorization</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {POST.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            {POST.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{POST.author}</span>
            <span aria-hidden>·</span>
            <span>{POST.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={POST.date}>
              {dateFormatter.format(new Date(POST.date))}
            </time>
            <span aria-hidden>·</span>
            <span>{POST.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">
          <p>
            I have seen this demo many times. The React app has a polished login
            screen. The identity provider redirects back. A JWT appears. The
            dashboard loads. Everybody relaxes because the padlock icon has
            entered the meeting.
          </p>

          <p>
            Then I change <code>/projects/alice-1</code> to{" "}
            <code>/projects/bob-1</code>
            {". "}The API returns Bob&apos;s project. Login was perfect.
            Authorization was on holiday.
          </p>

          <p>
            This is Broken Object Level Authorization, usually shortened to
            BOLA. The same family of bugs is also known as IDOR. It is
            especially easy to generate with AI because the endpoint looks
            complete: authentication, a scope check, validation, a database
            query, and a nice JSON response. Every requested feature is there.
            The missing feature is the one the prompt did not name.
          </p>

          <h2>The working endpoint that is not safe</h2>

          <CodeBlock language="ts" code={VULNERABLE_ROUTE} />

          <p>
            The route checks whether the caller may use the project-reading
            function. It never checks whether that caller may read this specific
            project.
          </p>

          <FlowDiagram
            title="Authorization is not one check"
            numbered
            steps={[
              {
                eyebrow: "identity",
                label: "Who are you?",
                detail: "valid token",
              },
              {
                eyebrow: "function",
                label: "May you read projects?",
                detail: "projects:read",
              },
              {
                eyebrow: "object",
                label: "May you read this project?",
                detail: "id + owner + tenant",
                tone: "accent",
              },
              {
                eyebrow: "property",
                label: "Which fields may leave?",
                detail: "response schema",
                tone: "success",
              },
            ]}
            caption="Most login tutorials stop after the first or second box. BOLA lives in the third box."
          />

          <h2>Three layers, three different jobs</h2>

          <p>
            Function-level authorization is usually a scope or role. It decides
            whether the caller may attempt an operation such as reading projects
            or refunding an order.
          </p>

          <p>
            Object-level authorization connects the principal to one record. It
            decides whether Alice may read project 42, not whether Alice may
            read projects in general.
          </p>

          <p>
            Property-level authorization decides which fields the caller may
            read or change. A project owner may rename a project without being
            allowed to set <code>ownerId</code>
            {", "}
            <code>tenantId</code>
            {", "}
            <code>approvedAt</code>
            {", "}or <code>role</code>
            {". "}Giving someone the Edit button does not mean handing them the
            database row and a pen.
          </p>

          <h2>Normalize identity once</h2>

          <p>
            The solution should not depend on one identity vendor. Auth0,
            Cognito, Entra ID, Clerk, Keycloak, Zitadel, Ory, or a signed
            session can all produce the same application principal:
          </p>

          <CodeBlock language="ts" code={PRINCIPAL} />

          <p>
            Map the pair <code>(issuer, subject)</code> to one immutable
            application user ID. Do not use email as your ownership key. Email
            is contact information wearing a fake moustache and pretending to be
            a primary key.
          </p>

          <h2>Put ownership into the data operation</h2>

          <p>
            The safest repository is one that makes owner-scoped operations
            boring and obvious. This interface works with any ORM, SQL builder,
            document database, key-value store, or in-memory test double:
          </p>

          <CodeBlock language="ts" code={SAFE_REPOSITORY} />

          <p>
            A real implementation should combine the resource ID and trusted
            owner or tenant in the same database query. Avoid loading by ID,
            checking in application code, then mutating by ID in a separate
            operation. That pattern is easy to weaken during refactoring and can
            create a time-of-check to time-of-use gap.
          </p>

          <CodeBlock language="ts" code={SAFE_ROUTE} />

          <p>
            Return the same <code>404</code> for a missing project and a project
            owned by somebody else when revealing existence would be sensitive.
            A <code>403</code> can tell Alice that Bob&apos;s secret project ID
            is real. Sometimes that disclosure is acceptable. It should be a
            decision, not an accident.
          </p>

          <h2>The client does not choose ownership</h2>

          <p>
            Creation endpoints have a second common problem: mass assignment.
            The AI passes the whole request body to the ORM, so a helpful caller
            includes <code>ownerId</code>
            {", "}
            <code>role</code>
            {", "}or <code>isApproved</code>
            {". "}Very efficient. The attacker appreciates the developer
            experience.
          </p>

          <CodeBlock language="ts" code={CREATE_ROUTE} />

          <p>
            Strict request schemas reject privileged fields. Response schemas
            perform the other half of the job by preventing internal flags,
            deleted records, billing metadata, or credentials from leaving the
            API.
          </p>

          <h2>One-user tests cannot prove isolation</h2>

          <p>
            A happy-path test proves Alice can use the product. It says nothing
            about Bob&apos;s data. Every user-owned or tenant-owned resource
            needs at least two principals in the test suite.
          </p>

          <CodeBlock language="ts" code={ATTACK_TESTS} />

          <p>
            Repeat the same idea for list, update, and delete operations. Add a
            cross-tenant case when the product has organizations. Add an
            explicit admin case when support staff need access, and verify that
            the bypass creates an audit event.
          </p>

          <h2>Why AI keeps generating this bug</h2>

          <p>
            Business owners ask for login because login is visible. They ask for
            CRUD because CRUD is visible. They rarely ask for object-level
            authorization because they do not know the term, and they should not
            need an application-security vocabulary to request a normal product.
          </p>

          <p>
            The coding agent optimizes for the prompt. It reaches the happy
            path, sees a valid token, and moves on. A bigger pile of tutorials
            does not automatically help if those tutorials also stop at
            &quot;add JWT middleware, job done.&quot;
          </p>

          <p>
            This rule belongs in framework documentation, executable tutorials,
            project scaffolds, AI instructions, and tests. Repetition here is
            cheaper than explaining a cross-customer data leak.
          </p>

          <CodeBlock language="text" code={AGENT_RULE} />

          <h2>What the framework can and cannot do</h2>

          <p>
            DaloyJS can verify identity, enforce scopes, validate identifiers,
            reject unexpected properties, validate response bodies, redact
            production errors, and carry a typed principal into the handler. It
            cannot know whether an invoice belongs to a user, an organization,
            both, or neither. That is business policy.
          </p>

          <p>
            The framework can still make the policy difficult to forget. The
            official guidance now classifies identifier routes, favors
            owner-scoped repository operations, rejects client-selected
            ownership, and requires Alice-versus-Bob tests in generated agent
            instructions.
          </p>

          <h2>A short note about Django, TypeScript, and hiring</h2>

          <p>
            I would not reject Django because it is old. Mature software is not
            a yoghurt with an expiry date. Django&apos;s integrated security
            features are useful.
          </p>

          <p>
            I would still choose a TypeScript backend when the available team
            already builds React and TypeScript every day, or when hiring for
            that stack is materially easier for the business. Sharing language,
            types, generated clients, and mental models across the frontend and
            backend is a legitimate operational advantage.
          </p>

          <p>
            That staffing decision is not a security control. React developers
            do not receive object-level authorization through osmosis. Choose
            the stack your team can maintain, then make the authorization policy
            structural in that stack.
          </p>

          <h2>Authorize the resource</h2>

          <p>
            A valid JWT proves that the identity provider recognizes the caller.
            A scope proves that the caller may attempt an operation. Neither
            proves ownership of the ID in the URL.
          </p>

          <p>
            Scope every user-owned and tenant-owned data operation using trusted
            principal data. Reject privileged ownership fields. Test with two
            users. Make admin bypasses explicit and audited. If Alice can change
            one character in a URL and become Bob, the login screen was only
            expensive decoration.
          </p>

          <p>
            Read the complete{" "}
            <Link href={"/docs/security/resource-authorization" as Route}>
              resource authorization guide
            </Link>{" "}
            and build the{" "}
            <Link href={"/docs/tutorials/multi-user-api" as Route}>
              multi-user projects tutorial
            </Link>
            {". "}The tutorial includes the attack tests, because an
            authorization guide without an attacker is just optimistic
            documentation.
          </p>

          <div className="not-prose mt-10 rounded-2xl border bg-muted/35 p-5">
            <p className="text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">
                About the author:
              </span>{" "}
              {POST.authorBio}
            </p>
          </div>
        </div>
      </article>
    </main>
  );
}
