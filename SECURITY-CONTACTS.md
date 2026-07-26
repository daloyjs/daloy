# DaloyJS Security Contacts

This file is the **single source of truth** for who is allowed to:

1. Approve the protected `npm-publish` GitHub Environment for a release.
2. Coordinate response to a privately reported vulnerability.
3. Run the quarterly disclosure exercise (tracked in [ROADMAP](./ROADMAP.md)).

It is machine-readable by [`scripts/verify-governance-audits.ts`](./scripts/verify-governance-audits.ts).
A change to this file requires CODEOWNERS approval. The CI gate refuses to
publish `@daloyjs/core` or `create-daloy` when the GitHub actor on the publish
run is not in the rotation below.

The rotation is the floor, not the ceiling. Adding a contributor here does
**not** grant them write access; the GitHub organization, npm, and the
`npm-publish` Environment all enforce their own 2FA / membership policies
separately.

---

## Rotation

The format below is parsed by the audit script. Do not change the field names
or the bullet shape. Add new contacts at the bottom of the active list and
move retired contacts to the **Off-boarded** section with the date.

### Active

<!-- BEGIN ACTIVE -->

- handle: daloyjs-bot
  role: release-automation
  scopes: [approve-npm-publish]
  pgp: null
  added: 2026-05-20
- handle: devlinduldulao
  role: maintainer
  scopes: [approve-npm-publish, coordinate-disclosure]
  pgp: null
  added: 2026-05-20
- handle: aurorascharff
  role: maintainer
  scopes: [approve-npm-publish, coordinate-disclosure]
  pgp: null
  added: 2026-06-21

<!-- END ACTIVE -->

### Off-boarded

<!-- BEGIN OFFBOARDED -->
<!-- END OFFBOARDED -->

---

## Quarterly disclosure exercise

Per the [ROADMAP](./ROADMAP.md), the disclosure rotation is tested
at least once per quarter with a simulated report. The exercise verifies that:

1. The private vulnerability-report inbox is monitored within the 3-business-day
   acknowledgement target documented in [SECURITY.md](./SECURITY.md).
2. Every handle in the **Active** list above can authenticate to GitHub and
   npm with hardware-backed 2FA.
3. The protected `npm-publish` Environment still requires explicit approval
   before any publish job executes.
4. The CI gate `pnpm verify:governance-audits` exits zero on `main`.
5. The GitHub **and** npm account-recovery email address for every handle in
   the **Active** list above still resolves to a domain the contact
   personally owns, or to a custodial provider (e.g. Gmail, iCloud, Fastmail)
   where the contact still has an active account. This guards against the
   `node-ipc` 2026-05-14 attack pattern, where a dormant maintainer was
   compromised by re-registering the lapsed domain of their npm recovery
   email and triggering a standard password reset. A lapsed-domain finding
   blocks the next publish until the affected contact rotates their
   recovery address.

> `_<date>_ — quarterly disclosure exercise completed. Findings: <short summary>.`

The audit script reads the `<!-- last-exercise: YYYY-MM-DD -->` marker below,
warns when the date is older than 90 days, and refuses with a non-zero exit
when older than 180 days so a missed quarter fails CI loud instead of silently
aging out.

<!-- last-exercise: 2026-05-20 -->

---

## Adding or removing a contact

Adding:

1. Open a PR that edits **only** the `### Active` block above and the
   `<!-- last-exercise: ... -->` marker if the change coincides with a fresh
   exercise.
2. The PR requires CODEOWNERS approval (`.github/CODEOWNERS` already protects
   this file).
3. After merge, run a fresh disclosure exercise.

Removing (off-boarding):

1. Move the contact's bullet from `### Active` to `### Off-boarded` with the
   off-boarding date appended.
2. Revoke their GitHub organization membership, their npm publish grant, and
   any granular tokens scoped to `@daloyjs/*` packages **before** their last
   day.
3. Confirm the next publish run uses an actor that is still in `### Active`.
