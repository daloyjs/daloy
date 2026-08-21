import { test } from "node:test";
import assert from "node:assert/strict";

import {
  notFoundProblem,
  problemResponse,
  serializeProblem,
} from "../../lib/problem-json";
import { trustPageCharacterCount } from "../../lib/trust-content";
import {
  ABOUT_PARAGRAPHS,
  CONTACT_PARAGRAPHS,
  PRIVACY_PARAGRAPHS,
} from "../../lib/trust-content";
import { buildOrganizationJsonLd } from "../../lib/seo";
import { notFoundMarkdown } from "../../lib/not-found-body";

test("problem+json includes code, message, and a resolution hint", async () => {
  const problem = notFoundProblem("/api/nope");
  const response = problemResponse(problem);
  assert.equal(response.status, 404);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
  assert.match(response.headers.get("vary") ?? "", /Accept/);

  const body = JSON.parse(await response.text()) as {
    code: string;
    detail: string;
    hint: string;
    status: number;
  };
  assert.equal(body.status, 404);
  assert.equal(body.code, "not_found");
  assert.ok(body.detail.length > 0);
  assert.match(body.hint, /openapi\.json/);
  assert.equal(JSON.parse(serializeProblem(problem)).code, "not_found");
});

test("Organization JSON-LD includes contactPoint and PostalAddress", () => {
  const org = buildOrganizationJsonLd();
  const contact = org.contactPoint as {
    "@type": string;
    email: string;
    contactType: string;
  };
  const address = org.address as { "@type": string; addressCountry: string };

  assert.equal(org["@type"], "Organization");
  assert.equal(contact["@type"], "ContactPoint");
  assert.ok(contact.email.includes("@"));
  assert.ok(contact.contactType.length > 0);
  assert.equal(address["@type"], "PostalAddress");
  assert.equal(address.addressCountry, "NO");
});

test("trust-anchor pages each have at least 500 characters of copy", () => {
  assert.ok(trustPageCharacterCount(ABOUT_PARAGRAPHS) >= 500);
  assert.ok(trustPageCharacterCount(CONTACT_PARAGRAPHS) >= 500);
  assert.ok(trustPageCharacterCount(PRIVACY_PARAGRAPHS) >= 500);
});

test("markdown 404 body points at sitemap, llms.txt, and docs", () => {
  const body = notFoundMarkdown("/does-not-exist");
  assert.match(body, /# 404 Not Found/);
  assert.match(body, /sitemap\.xml/);
  assert.match(body, /llms\.txt/);
  assert.match(body, /\/docs/);
  assert.match(body, /DaloyJS API docs/);
  assert.match(body, /DaloyJS MCP server/);
});
