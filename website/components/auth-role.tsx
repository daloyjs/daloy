import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The three roles defined by OAuth 2.0 / OpenID Connect.
 *
 * Documentation pages that describe an identity-adjacent capability tag it with
 * the role that owns it, so a reader who lands on the page from a search engine
 * gets the same framing as a reader who started at
 * `/docs/auth/architecture`.
 */
export type OAuthRole =
  "authorization-server" | "resource-server" | "client-rp";

interface RoleCopy {
  /** Human-readable role name, matching the table on the auth architecture page. */
  readonly label: string;
  /** One-line verdict: does DaloyJS own this, or should a provider? */
  readonly verdict: string;
  /** What the role is responsible for, in plain terms. */
  readonly detail: string;
  /** Tailwind classes for the accent color of this role. */
  readonly accent: string;
  /** Tailwind classes for the badge chip. */
  readonly chip: string;
}

const ROLE_COPY: Record<OAuthRole, RoleCopy> = {
  "authorization-server": {
    label: "Authorization Server",
    verdict: "Not DaloyJS. Bring an identity provider.",
    detail:
      "Owns login screens, user records, credential resets, MFA, consent, client registration, and token issuance and revocation. This is the hardest part of authentication to get right, and getting it wrong is a breach rather than a bug. Use a managed provider (Auth0, Okta, Entra ID, Cognito, Clerk) or a vetted self-hosted one (Keycloak, Zitadel, Ory).",
    accent: "border-rose-500/25 bg-rose-500/[0.03] dark:bg-rose-500/[0.06]",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  },
  "resource-server": {
    label: "Resource Server",
    verdict: "Your API's job. DaloyJS is built for this.",
    detail:
      "Accepts a token that somebody else issued, verifies its signature and claims, and decides whether this caller may touch this resource. Verifying is not the same as issuing: you always own verification, even when a provider owns the login.",
    accent:
      "border-emerald-500/25 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.06]",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  },
  "client-rp": {
    label: "Client / Relying Party",
    verdict: "Yours when you run a BFF. DaloyJS ships the building blocks.",
    detail:
      "Starts the login redirect, exchanges the code, and holds the browser session on behalf of the user. If your frontend talks to a server you own, that server is the relying party and these primitives are the right tool. It still does not issue the tokens.",
    accent: "border-amber-500/25 bg-amber-500/[0.03] dark:bg-amber-500/[0.06]",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  },
};

interface AuthRoleProps {
  /** Which OAuth2 / OIDC role owns the capability documented on this page. */
  role: OAuthRole;
  /**
   * Optional page-specific nuance, rendered under the shared role description.
   * Use it to name the concrete API and say what a reader should do instead.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * Callout that states which OAuth2 / OIDC role owns the capability being
 * documented, so readers can tell "DaloyJS does this for you" apart from
 * "an identity provider does this and you should not rebuild it".
 *
 * Required on every identity-adjacent docs page. See `website/AGENTS.md`.
 */
export function AuthRole({ role, children, className }: AuthRoleProps) {
  const copy = ROLE_COPY[role];

  return (
    <aside
      className={cn(
        "not-prose my-6 rounded-xl border p-5 text-sm",
        copy.accent,
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
          OAuth2 role
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
            copy.chip,
          )}
        >
          {copy.label}
        </span>
      </div>

      <p className="mt-3 font-semibold text-foreground">{copy.verdict}</p>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        {copy.detail}
      </p>

      {children ? (
        <div className="mt-3 leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        <Link
          href="/docs/auth/architecture"
          className="font-medium underline underline-offset-4"
        >
          Auth architecture: where DaloyJS fits in OAuth2 &amp; OpenID Connect
        </Link>{" "}
        explains all three roles and the two deployment shapes we recommend.
      </p>
    </aside>
  );
}

interface IdpBoundaryProps {
  /** Name of the API or capability the boundary applies to. */
  featureName: ReactNode;
  /** Uses that are legitimately yours to implement. */
  safe: readonly ReactNode[];
  /** Uses that mean you have started building an identity provider. */
  delegate: readonly ReactNode[];
  /** Optional closing line, typically pointing at the provider docs. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Two-column boundary box for APIs that are legitimate in narrow cases but turn
 * into a home-grown identity provider when overused. Pairs with {@link AuthRole}
 * on pages such as the `createJwtSigner` reference.
 */
export function IdpBoundary({
  featureName,
  safe,
  delegate,
  footer,
  className,
}: IdpBoundaryProps) {
  return (
    <div className={cn("not-prose my-8 space-y-4", className)}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Where {featureName} stops being your job
      </h4>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.02] p-5 dark:bg-emerald-500/[0.05]">
          <h5 className="mb-3 border-b border-emerald-500/10 pb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Reasonable to implement yourself
          </h5>
          <ul className="list-none space-y-2.5 pl-0 text-xs leading-relaxed text-muted-foreground">
            {safe.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-left">
                <span className="mt-0.5 shrink-0 font-bold text-emerald-500">
                  &#10003;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.02] p-5 dark:bg-rose-500/[0.05]">
          <h5 className="mb-3 border-b border-rose-500/10 pb-2 text-sm font-semibold text-rose-700 dark:text-rose-400">
            You are building an identity provider
          </h5>
          <ul className="list-none space-y-2.5 pl-0 text-xs leading-relaxed text-muted-foreground">
            {delegate.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-left">
                <span className="mt-0.5 shrink-0 font-bold text-rose-500">
                  &#10007;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {footer ? (
        <p className="text-xs leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4">
          {footer}
        </p>
      ) : null}
    </div>
  );
}
