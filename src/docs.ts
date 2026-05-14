/**
 * Built-in API documentation handlers.
 *
 * Both serve a single self-contained HTML page that loads the spec at
 * `specUrl` from a CDN. No build step, no extra deps.
 *
 * (You can self-host the assets if your CSP forbids CDNs.)
 */

export interface DocsOptions {
  specUrl: string;
  title?: string;
}

export function scalarHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`;
}

export function swaggerUiHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const url = escapeHtml(opts.specUrl);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css" />
</head><body>
<div id="swagger"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:"${url}",dom_id:"#swagger"});</script>
</body></html>`;
}

export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Docs pages are intentionally permissive about external scripts; lock to those CDNs.
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
