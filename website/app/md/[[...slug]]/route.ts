import { renderPathMarkdown } from "@/lib/render-page-markdown";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * Markdown representation of any public page.
 *
 * Reached by:
 * - `Accept: text/markdown` on the canonical URL (rewritten here in proxy.ts)
 * - a `.md` suffix (rewritten here by next.config.ts and proxy.ts)
 *
 * Unknown paths return HTTP 404 with an agent-recovery Markdown body (sitemap,
 * llms.txt, docs index). Successful responses set `Vary: Accept` so caches do
 * not mix the HTML and Markdown variants, and carry the same RFC RateLimit
 * headers as the JSON APIs so an agent bulk-reading Markdown can self-throttle
 * from the response instead of guessing.
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
  const path = slug?.length ? `/${slug.join("/")}` : "/";
  const result = await renderPathMarkdown(new URL(request.url).origin, path);

  return new Response(result.markdown, {
    status: result.status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept, Accept-Encoding",
      "cache-control":
        result.status === 200 ? "public, max-age=3600" : "no-store",
      ...siteApiHeaders(quota.snapshot),
    },
  });
}
