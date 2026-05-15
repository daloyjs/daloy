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
  assets?: {
    scalarScriptUrl?: string;
    swaggerUiCssUrl?: string;
    swaggerUiBundleUrl?: string;
  };
  scriptNonce?: string;
}

export interface DocsContentSecurityPolicyOptions {
  assetOrigins?: string[];
  scriptNonce?: string;
  allowInlineStyles?: boolean;
}

export interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  contentSecurityPolicy?: string;
}

const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
}

export function scalarHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  const scriptUrl = escapeHtml(opts.assets?.scalarScriptUrl ?? `${JSDELIVR_ORIGIN}/npm/@scalar/api-reference`);
  const nonce = nonceAttr(opts.scriptNonce);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"${nonce}></script>
<script src="${scriptUrl}"${nonce}></script>
</body></html>`;
}

export function swaggerUiHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const url = escapeHtml(opts.specUrl);
  const cssUrl = escapeHtml(opts.assets?.swaggerUiCssUrl ?? `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`);
  const bundleUrl = escapeHtml(opts.assets?.swaggerUiBundleUrl ?? `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`);
  const nonce = nonceAttr(opts.scriptNonce);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${cssUrl}" />
</head><body>
<div id="swagger"></div>
<script src="${bundleUrl}"${nonce}></script>
<script${nonce}>window.onload=()=>SwaggerUIBundle({url:"${url}",dom_id:"#swagger"});</script>
</body></html>`;
}

export function docsContentSecurityPolicy(opts: DocsContentSecurityPolicyOptions = {}): string {
  const assetOrigins = opts.assetOrigins ?? [JSDELIVR_ORIGIN];
  const scriptSrc = ["'self'", ...assetOrigins];
  if (opts.scriptNonce) scriptSrc.push(`'nonce-${opts.scriptNonce}'`);
  else scriptSrc.push("'unsafe-inline'");

  const styleSrc = ["'self'", ...assetOrigins];
  if (opts.allowInlineStyles !== false) styleSrc.push("'unsafe-inline'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data: https:",
    "connect-src 'self'",
  ].join("; ");
}

export function htmlResponse(html: string, opts: HtmlResponseOptions = {}): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        opts.contentSecurityPolicy ??
        docsContentSecurityPolicy({
          assetOrigins: opts.assetOrigins,
          scriptNonce: opts.scriptNonce,
          allowInlineStyles: opts.allowInlineStyles,
        }),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
