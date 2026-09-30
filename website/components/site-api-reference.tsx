import { SITE_URL } from "@/lib/seo";
import { buildSiteOpenApiDocument } from "@/lib/site-openapi";

import { OpenApiReference } from "./openapi-reference";

/**
 * The daloyjs.dev agent-facing API, rendered from the same OpenAPI 3.1
 * document served at `/openapi.json` (`buildSiteOpenApiDocument`), so the
 * reference page and the spec cannot disagree. "Try it" is enabled because
 * this site serves the spec itself (same-origin requests only).
 */
export function SiteApiReference() {
  return <OpenApiReference spec={buildSiteOpenApiDocument()} baseUrl={SITE_URL} tryIt />;
}
