import { renderPathMarkdown } from "@/lib/render-page-markdown";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import {
  deprecationHeaders,
  findApiSurface,
  surfaceLinkRelations,
} from "@/lib/site-deprecation";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * Compatibility Markdown endpoint for `/docs/*.md`. **Deprecated.**
 *
 * New requests are rewritten to `/md/*` by proxy.ts and next.config.ts. This
 * handler stays so older rewrites and cached destinations keep working and
 * still emit the same Markdown as `/md/docs/...`.
 *
 * Because it is a surface on the way out, every response carries the machine
 * signals an agent needs to migrate on its own: an RFC 9745 `Deprecation`
 * date, RFC 8288 `deprecation` / `successor-version` / `latest-version` link
 * relations, and (once a retirement is scheduled) an RFC 8594 `Sunset` date.
 * The lifecycle record lives in `lib/site-deprecation.ts`; no date is
 * scheduled today, and none will be set less than 180 days ahead.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const { slug } = await params;
  const path = slug?.length ? `/docs/${slug.join("/")}` : "/docs";
  const result = await renderPathMarkdown(new URL(request.url).origin, path);
  const surface = findApiSurface("/docs-md");

  return new Response(result.markdown, {
    status: result.status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept, Accept-Encoding",
      "cache-control":
        result.status === 200 ? "public, max-age=3600" : "no-store",
      ...siteApiHeaders(quota.snapshot),
      ...(surface
        ? {
            ...deprecationHeaders(surface),
            link: surfaceLinkRelations(surface).join(", "),
          }
        : {}),
    },
  });
}
