/**
 * Built-in API documentation handlers.
 *
 * Scalar and Swagger UI helpers serve a single HTML page that loads the spec
 * at `specUrl` and fetches UI assets from a CDN by default. No build step,
 * no extra deps.
 *
 * (You can self-host the assets if your CSP forbids CDNs.)
 */

/** JSON primitive accepted by {@link ScalarReferenceConfiguration}. */
export type ScalarJsonPrimitive = string | number | boolean | null;
/** Recursive JSON value accepted by Scalar configuration fields. */
export type ScalarJsonValue =
  | ScalarJsonPrimitive
  | ScalarJsonValue[]
  | { [key: string]: ScalarJsonValue | undefined };

/** Built-in Scalar API Reference color theme names. */
export type ScalarTheme =
  | "alternate"
  | "default"
  | "moon"
  | "purple"
  | "solarized"
  | "bluePlanet"
  | "saturn"
  | "kepler"
  | "mars"
  | "deepSpace"
  | "laserwave"
  | "none";

/**
 * Subset of Scalar API Reference configuration safe to serialize from the
 * server (function callbacks and inline `spec` are intentionally excluded).
 *
 * Forwarded verbatim as the `data-configuration` attribute on the Scalar
 * script tag.
 */
export interface ScalarReferenceConfiguration {
  [key: string]: ScalarJsonValue | undefined;
  theme?: ScalarTheme;
  customCss?: string;
  darkMode?: boolean;
  forceDarkModeState?: "dark" | "light";
  withDefaultFonts?: boolean;
  favicon?: string;
  layout?: "modern" | "classic";
  hideClientButton?: boolean;
  hideDarkModeToggle?: boolean;
  hideModels?: boolean;
  hideSearch?: boolean;
  hideTestRequestButton?: boolean;
  showOperationId?: boolean;
  showSidebar?: boolean;
  showDeveloperTools?: "always" | "localhost" | "never";
  defaultOpenFirstTag?: boolean;
  defaultOpenAllTags?: boolean;
  expandAllModelSections?: boolean;
  expandAllResponses?: boolean;
  documentDownloadType?: "json" | "yaml" | "both" | "direct" | "none";
  operationTitleSource?: "summary" | "path";
  orderRequiredPropertiesFirst?: boolean;
  orderSchemaPropertiesBy?: "alpha" | "preserve";
  searchHotKey?: string;
  baseServerURL?: string;
  proxyUrl?: string;
  oauth2RedirectUri?: string;
  persistAuth?: boolean;
  telemetry?: boolean;
  tagsSorter?: "alpha";
  operationsSorter?: "alpha" | "method";
  authentication?: { [key: string]: ScalarJsonValue | undefined };
  defaultHttpClient?: { [key: string]: ScalarJsonValue | undefined };
  metaData?: { [key: string]: ScalarJsonValue | undefined };
  mcp?: { [key: string]: ScalarJsonValue | undefined };
  pathRouting?: { [key: string]: ScalarJsonValue | undefined };
  servers?: ScalarJsonValue[];
  content?: never;
  fetch?: never;
  generateHeadingSlug?: never;
  generateModelSlug?: never;
  generateOperationSlug?: never;
  generateTagSlug?: never;
  generateWebhookSlug?: never;
  onBeforeRequest?: never;
  onDocumentSelect?: never;
  onLoaded?: never;
  onRequestSent?: never;
  onServerChange?: never;
  onShowMore?: never;
  onSidebarClick?: never;
  onSpecUpdate?: never;
  plugins?: never;
  redirect?: never;
  sources?: never;
  spec?: never;
  url?: never;
}

/** Shared options for {@link scalarHtml} and {@link swaggerUiHtml}. */
export interface DocsOptions {
  /** Absolute or relative URL of the OpenAPI document to render. */
  specUrl: string;
  /** `<title>` of the generated HTML page. */
  title?: string;
  /** Override CDN URLs for the docs UI assets (useful for self-hosting). */
  assets?: {
    scalarScriptUrl?: string;
    swaggerUiCssUrl?: string;
    swaggerUiBundleUrl?: string;
  };
  /** CSP `nonce` to apply to inline/script tags; must match the response CSP. */
  scriptNonce?: string;
}

/** Options for {@link scalarHtml}; adds Scalar-specific UI configuration. */
export interface ScalarHtmlOptions extends DocsOptions {
  /** Forwarded to the Scalar `<script id="api-reference">` tag. */
  configuration?: ScalarReferenceConfiguration;
}

/** Options for {@link docsContentSecurityPolicy}. */
export interface DocsContentSecurityPolicyOptions {
  /** Extra origins to allow for `script-src` / `style-src` (defaults to jsDelivr). */
  assetOrigins?: string[];
  /** When set, allows nonce-protected inline scripts instead of `'unsafe-inline'`. */
  scriptNonce?: string;
  /** When `false`, omits `'unsafe-inline'` from `style-src`. Defaults to `true`. */
  allowInlineStyles?: boolean;
}

/** Options for {@link htmlResponse}. */
export interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  /** Override the computed `content-security-policy` header verbatim. */
  contentSecurityPolicy?: string;
}

const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
}

/**
 * Render a Scalar API Reference HTML page that loads `opts.specUrl`.
 *
 * The output is a single HTML document with configurable external assets;
 * pair it with {@link htmlResponse} (or your own `Response`) and serve from
 * any route.
 */
export function scalarHtml(opts: ScalarHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  const scriptUrl = escapeHtml(
    opts.assets?.scalarScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/@scalar/api-reference`,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const configuration = scalarConfigurationAttr(
    opts.specUrl,
    opts.configuration,
  );
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"${configuration}${nonce}></script>
<script src="${scriptUrl}"${nonce}></script>
</body></html>`;
}

/**
 * Render a Swagger UI HTML page that loads `opts.specUrl`. Same usage as
 * {@link scalarHtml} but emits the classic Swagger UI bundle.
 */
export function swaggerUiHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const url = escapeHtml(opts.specUrl);
  const cssUrl = escapeHtml(
    opts.assets?.swaggerUiCssUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`,
  );
  const bundleUrl = escapeHtml(
    opts.assets?.swaggerUiBundleUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`,
  );
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

/**
 * Build a Content-Security-Policy string compatible with the docs HTML
 * produced by {@link scalarHtml} / {@link swaggerUiHtml}.
 *
 * Allows `'self'` plus the listed `assetOrigins` (default: jsDelivr) and
 * either `'unsafe-inline'` or the provided `scriptNonce` for scripts.
 */
export function docsContentSecurityPolicy(
  opts: DocsContentSecurityPolicyOptions = {},
): string {
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

/**
 * Wrap a docs HTML string in a `Response` with safe defaults:
 * `text/html` content type, `nosniff`, `no-referrer`, and a CSP from
 * {@link docsContentSecurityPolicy} (or a caller-supplied override).
 */
export function htmlResponse(
  html: string,
  opts: HtmlResponseOptions = {},
): Response {
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
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function scalarConfigurationAttr(
  specUrl: string,
  configuration: ScalarReferenceConfiguration | undefined,
): string {
  if (!configuration) return "";
  const {
    content: _content,
    fetch: _fetch,
    plugins: _plugins,
    sources: _sources,
    spec: _spec,
    url: _url,
    ...uiConfiguration
  } = configuration;
  return ` data-configuration='${escapeHtml(JSON.stringify({ ...uiConfiguration, url: specUrl }))}'`;
}
