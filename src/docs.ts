/**
 * Built-in API documentation handlers.
 *
 * Scalar, Swagger UI, and Redoc helpers serve a single HTML page that loads
 * the spec at `specUrl` and fetches UI assets from a CDN by default. No build
 * step, no extra deps.
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

/**
 * Subset of Redoc standalone configuration safe to serialize from the server.
 *
 * Every field is a plain JSON value, so the whole object is forwarded verbatim
 * to `Redoc.init(specUrl, configuration, element)` in the generated page. The
 * index signature accepts any additional Redoc option (the standalone bundle's
 * option set drifts across versions); the named fields exist for editor
 * autocompletion of the common, stable ones. Function-typed options are not
 * representable here on purpose — they cannot cross the server→HTML boundary.
 *
 * @since 0.39.0
 */
export interface RedocConfiguration {
  [key: string]: ScalarJsonValue | undefined;
  /** Disable the search bar (also skips spawning the search Web Worker). */
  disableSearch?: boolean;
  /** Minimum query length before search runs. */
  minCharacterLengthToInitSearch?: number;
  /** Which responses to expand by default, e.g. `"200,201"` or `"all"`. */
  expandResponses?: string;
  /** Expand the single-property schema field instead of collapsing it. */
  expandSingleSchemaField?: boolean;
  /** Expand `default` server-variable values in the sidebar. */
  expandDefaultServerVariables?: boolean;
  /** How deep to expand generated JSON samples; a number or `"all"`. */
  jsonSampleExpandLevel?: number | string;
  /** How deep to expand nested schemas; a number or `"all"`. */
  schemasExpansionLevel?: number | string;
  /** Hide the "Download" button(s) for the spec. */
  hideDownloadButtons?: boolean;
  /** Override the URL used by the download button. */
  downloadDefinitionUrl?: string;
  /** Hide the API host from the docs. */
  hideHostname?: boolean;
  /** Hide the loading spinner. */
  hideLoading?: boolean;
  /** Hide the request payload sample tab. */
  hideRequestPayloadSample?: boolean;
  /** Hide the `pattern` shown for string schemas. */
  hideSchemaPattern?: boolean;
  /** Hide schema title captions. */
  hideSchemaTitles?: boolean;
  /** Hide the entire Security section. */
  hideSecuritySection?: boolean;
  /** Hide the single-sample tab when there is only one request sample. */
  hideSingleRequestSampleTab?: boolean;
  /** Largest number of enum values to show before collapsing. */
  maxDisplayedEnumValues?: number;
  /** Collapse sidebar items on selection (single-expanded menu behaviour). */
  menuToggle?: boolean;
  /** Use the browser's native scrollbars instead of custom ones. */
  nativeScrollbars?: boolean;
  /** Show only required fields in request samples. */
  onlyRequiredInSamples?: boolean;
  /** Render the path in the middle panel instead of the right one. */
  pathInMiddlePanel?: boolean;
  /** Index of the request sample shown first. */
  payloadSampleIdx?: number;
  /** Sort required properties before optional ones. */
  requiredPropsFirst?: boolean;
  /** Pixels of fixed offset for in-page anchor scrolling; a number or selector. */
  scrollYOffset?: number | string;
  /** Show vendor `x-` extensions; `true`/`false` or an allowlist of names. */
  showExtensions?: boolean | string[];
  /** Show object schema examples. */
  showObjectSchemaExamples?: boolean;
  /** Show the HTTP verb badge for webhooks. */
  showWebhookVerb?: boolean;
  /** Use a simple `oneOf` type label instead of an expandable selector. */
  simpleOneOfTypeLabel?: boolean;
  /** Sort enum values alphabetically. */
  sortEnumValuesAlphabetically?: boolean;
  /** Sort operations alphabetically. */
  sortOperationsAlphabetically?: boolean;
  /** Sort schema properties alphabetically. */
  sortPropsAlphabetically?: boolean;
  /** Sort tags alphabetically. */
  sortTagsAlphabetically?: boolean;
  /** Nested Redoc theme object (colors, typography, sidebar, etc.). */
  theme?: { [key: string]: ScalarJsonValue | undefined };
}

/**
 * Override CDN URLs and pin Subresource Integrity (SRI) hashes for the docs
 * UI assets.
 *
 * Supplying an `*Integrity` value emits an `integrity="…"` attribute plus a
 * `crossorigin` attribute on the matching `<script>` / `<link>` tag so the
 * browser refuses to execute a CDN asset whose bytes don't match the pinned
 * hash. SRI is only meaningful against a **version-pinned** URL
 * (e.g. `…/@scalar/api-reference@1.25.0`); pair each integrity hash with a
 * pinned `*Url`, since the framework's default URLs intentionally track the
 * latest upstream release and therefore cannot carry a stable hash.
 *
 * @since 0.37.0
 */
export interface DocsAssetOptions {
  /** Override the Scalar API Reference bundle URL (useful for self-hosting). */
  scalarScriptUrl?: string;
  /**
   * SRI hash for {@link scalarScriptUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  scalarScriptIntegrity?: string;
  /** Override the Swagger UI stylesheet URL (useful for self-hosting). */
  swaggerUiCssUrl?: string;
  /**
   * SRI hash for {@link swaggerUiCssUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  swaggerUiCssIntegrity?: string;
  /** Override the Swagger UI bundle URL (useful for self-hosting). */
  swaggerUiBundleUrl?: string;
  /**
   * SRI hash for {@link swaggerUiBundleUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  swaggerUiBundleIntegrity?: string;
  /** Override the Redoc standalone bundle URL (useful for self-hosting). */
  redocScriptUrl?: string;
  /**
   * SRI hash for {@link redocScriptUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.39.0
   */
  redocScriptIntegrity?: string;
  /** Override the AsyncAPI React standalone bundle URL (useful for self-hosting). */
  asyncapiScriptUrl?: string;
  /**
   * SRI hash for {@link asyncapiScriptUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.42.0
   */
  asyncapiScriptIntegrity?: string;
  /** Override the AsyncAPI React component stylesheet URL (useful for self-hosting). */
  asyncapiStyleUrl?: string;
  /**
   * SRI hash for {@link asyncapiStyleUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.42.0
   */
  asyncapiStyleIntegrity?: string;
  /**
   * `crossorigin` attribute value emitted alongside any pinned integrity
   * hash. SRI on a cross-origin asset requires CORS, so this defaults to
   * `"anonymous"`; use `"use-credentials"` only when the asset host needs
   * credentialed requests.
   *
   * @since 0.37.0
   */
  crossOrigin?: "anonymous" | "use-credentials";
}

/** Shared options for {@link scalarHtml}, {@link swaggerUiHtml}, and {@link redocHtml}. */
export interface DocsOptions {
  /** Absolute or relative URL of the OpenAPI document to render. */
  specUrl: string;
  /** `<title>` of the generated HTML page. */
  title?: string;
  /**
   * Override CDN URLs and pin SRI hashes for the docs UI assets (useful for
   * self-hosting or supply-chain hardening). See {@link DocsAssetOptions}.
   */
  assets?: DocsAssetOptions;
  /** CSP `nonce` to apply to inline/script tags; must match the response CSP. */
  scriptNonce?: string;
}

/** Options for {@link scalarHtml}; adds Scalar-specific UI configuration. */
export interface ScalarHtmlOptions extends DocsOptions {
  /** Forwarded to the Scalar `<script id="api-reference">` tag. */
  configuration?: ScalarReferenceConfiguration;
}

/** JSON-only subset of Swagger UI's `SwaggerUIBundle(...)` configuration. */
export interface SwaggerUiConfiguration {
  [key: string]: ScalarJsonValue | undefined;
  /**
   * Preserve developer-entered API credentials across reloads. Defaults to
   * `true` in {@link swaggerUiHtml} so the built-in docs behave like a local
   * developer console instead of forgetting the bearer token on every refresh.
   */
  persistAuthorization?: boolean;
  /** Expand operations by default: `"list"`, `"full"`, or `"none"`. */
  docExpansion?: "list" | "full" | "none";
  /** Enable filtering operations by tag/path text. */
  filter?: boolean | string;
  /** Show operation extension fields such as `x-*`. */
  showExtensions?: boolean;
  /** Show common extension fields. */
  showCommonExtensions?: boolean;
  /** Render request duration after "Try it out" calls. */
  displayRequestDuration?: boolean;
  /** Sort operations by HTTP method, alphabetically, or with no sorter. */
  operationsSorter?: "alpha" | "method";
  /** Sort tags alphabetically or with no sorter. */
  tagsSorter?: "alpha";
  /**
   * Internal URL wiring owned by DaloyJS. Use {@link DocsOptions.specUrl}
   * instead of passing Swagger UI's `url` directly.
   */
  url?: never;
  /**
   * Internal DOM mount point owned by DaloyJS. The generated HTML always mounts
   * Swagger UI into `#swagger`.
   */
  dom_id?: never;
  /** Function-valued Swagger UI plugins cannot cross the server-to-HTML boundary. */
  plugins?: never;
  /** Function-valued presets cannot cross the server-to-HTML boundary. */
  presets?: never;
  /** Function-valued request interceptors cannot cross the server-to-HTML boundary. */
  requestInterceptor?: never;
  /** Function-valued response interceptors cannot cross the server-to-HTML boundary. */
  responseInterceptor?: never;
}

/** Options for {@link swaggerUiHtml}; adds Swagger UI-specific configuration. */
export interface SwaggerUiHtmlOptions extends DocsOptions {
  /** Forwarded into `SwaggerUIBundle(...)` after `url` and `dom_id`. */
  configuration?: SwaggerUiConfiguration;
}

/**
 * Options for {@link redocHtml}; adds Redoc-specific UI configuration.
 *
 * @since 0.39.0
 */
export interface RedocHtmlOptions extends DocsOptions {
  /** Forwarded as the options object to `Redoc.init(specUrl, configuration, element)`. */
  configuration?: RedocConfiguration;
}

/**
 * Options for {@link asyncapiHtml}; adds AsyncAPI-specific UI configuration.
 *
 * @since 0.42.0
 */
export interface AsyncApiHtmlOptions extends DocsOptions {
  /**
   * Forwarded as the `config` object to `AsyncApiStandalone.render({ schema, config }, el)`.
   * Defaults to showing the sidebar and inline errors.
   */
  configuration?: { [key: string]: ScalarJsonValue | undefined };
}

/** Options for {@link docsContentSecurityPolicy}. */
export interface DocsContentSecurityPolicyOptions {
  /** Extra origins to allow for `script-src` / `style-src` (defaults to jsDelivr). */
  assetOrigins?: string[];
  /**
   * Extra origins to allow for `connect-src`. Add API origins here when the
   * docs UI should send "Try it" requests somewhere other than the same origin
   * serving the docs page.
   *
   * @since 0.42.0
   */
  connectOrigins?: string[];
  /** When set, allows nonce-protected inline scripts instead of `'unsafe-inline'`. */
  scriptNonce?: string;
  /** When `false`, omits `'unsafe-inline'` from `style-src`. Defaults to `true`. */
  allowInlineStyles?: boolean;
  /**
   * When `true`, append `worker-src 'self' blob:` so a UI that constructs a
   * Web Worker from a `blob:` URL can run under this CSP. Redoc does this for
   * its search index, so the auto-mounted docs route enables it automatically
   * for `ui: "redoc"`; Scalar and Swagger UI do not need it. Defaults to
   * `false`, leaving the policy unchanged.
   *
   * @since 0.39.0
   */
  allowBlobWorkers?: boolean;
}

/** Options for {@link htmlResponse}. */
export interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  /** Override the computed `content-security-policy` header verbatim. */
  contentSecurityPolicy?: string;
}

const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

/**
 * Matches a single Subresource Integrity digest: a `sha256-`/`sha384-`/
 * `sha512-` prefix followed by standard base64 (with up to two `=` pads).
 * Linear-time / ReDoS-safe (no nested or overlapping quantifiers).
 */
const SRI_HASH = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
}

/**
 * Build the `integrity`/`crossorigin` attribute fragment for a docs asset.
 *
 * Returns an empty string when no `integrity` value is supplied. When one is
 * supplied it is validated as one or more space-separated SRI digests and a
 * `crossorigin` attribute (default `"anonymous"`) is emitted alongside it.
 * A malformed integrity value throws a {@link TypeError} so a typo fails
 * loudly instead of silently shipping a docs page with no SRI protection.
 *
 * @throws {TypeError} when `integrity` is provided but is not a valid SRI value.
 */
function integrityAttr(
  integrity: string | undefined,
  crossOrigin: DocsAssetOptions["crossOrigin"],
): string {
  if (integrity === undefined) return "";
  const tokens = integrity.trim().split(/\s+/);
  if (integrity.trim() === "" || tokens.some((t) => !SRI_HASH.test(t))) {
    throw new TypeError(
      `Invalid Subresource Integrity value: ${JSON.stringify(integrity)}. ` +
        `Expected one or more space-separated "sha256-"/"sha384-"/"sha512-" base64 hashes.`,
    );
  }
  const co = crossOrigin ?? "anonymous";
  return ` integrity="${escapeHtml(integrity.trim())}" crossorigin="${escapeHtml(co)}"`;
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
  const scriptSri = integrityAttr(
    opts.assets?.scalarScriptIntegrity,
    opts.assets?.crossOrigin,
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
<script src="${scriptUrl}"${scriptSri}${nonce}></script>
</body></html>`;
}

/**
 * Render a Swagger UI HTML page that loads `opts.specUrl`. Same usage as
 * {@link scalarHtml} but emits the classic Swagger UI bundle.
 *
 * Developer-entered credentials are persisted by default
 * (`persistAuthorization: true`) so routes with OpenAPI security requirements
 * can be exercised after using Swagger UI's Authorize dialog.
 */
export function swaggerUiHtml(opts: SwaggerUiHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const cssUrl = escapeHtml(
    opts.assets?.swaggerUiCssUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`,
  );
  const bundleUrl = escapeHtml(
    opts.assets?.swaggerUiBundleUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`,
  );
  const cssSri = integrityAttr(
    opts.assets?.swaggerUiCssIntegrity,
    opts.assets?.crossOrigin,
  );
  const bundleSri = integrityAttr(
    opts.assets?.swaggerUiBundleIntegrity,
    opts.assets?.crossOrigin,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const configuration = jsonForScript({
    persistAuthorization: true,
    ...(opts.configuration ?? {}),
    url: opts.specUrl,
    dom_id: "#swagger",
  });
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${cssUrl}"${cssSri} />
</head><body>
<div id="swagger"></div>
<script src="${bundleUrl}"${bundleSri}${nonce}></script>
<script${nonce}>window.onload=()=>SwaggerUIBundle(${configuration});</script>
</body></html>`;
}

/**
 * Render a Redoc HTML page that loads `opts.specUrl`. Same usage as
 * {@link scalarHtml} / {@link swaggerUiHtml} but emits the Redoc standalone
 * bundle and forwards {@link RedocHtmlOptions.configuration} to `Redoc.init`.
 *
 * Redoc constructs a Web Worker from a `blob:` URL for its search index, so
 * serve this page with a CSP that allows `worker-src 'self' blob:` — pass
 * `allowBlobWorkers: true` to {@link docsContentSecurityPolicy} /
 * {@link htmlResponse} (the `docs: { ui: "redoc" }` auto-mount does this for
 * you). The spec URL and configuration are embedded with `<`-escaped JSON so
 * an attacker-controlled value cannot break out of the inline `<script>`.
 *
 * @since 0.39.0
 */
export function redocHtml(opts: RedocHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const scriptUrl = escapeHtml(
    opts.assets?.redocScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/redoc/bundles/redoc.standalone.js`,
  );
  const scriptSri = integrityAttr(
    opts.assets?.redocScriptIntegrity,
    opts.assets?.crossOrigin,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const specArg = jsonForScript(opts.specUrl);
  const optionsArg = jsonForScript(opts.configuration ?? {});
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<div id="redoc"></div>
<script src="${scriptUrl}"${scriptSri}${nonce}></script>
<script${nonce}>Redoc.init(${specArg},${optionsArg},document.getElementById("redoc"));</script>
</body></html>`;
}

/**
 * Render an AsyncAPI HTML page that loads `opts.specUrl` (an AsyncAPI 3.0
 * document) into the official AsyncAPI React component. Same shape as
 * {@link redocHtml}: a prebuilt standalone bundle is loaded from a CDN via a
 * `<script>` tag (no build step, no extra deps) and the spec URL is handed to
 * `AsyncApiStandalone.render(...)`. This is the AsyncAPI equivalent of the
 * Scalar / Swagger UI / Redoc OpenAPI viewers.
 *
 * Serve it with the same CSP as the OpenAPI docs UIs ({@link docsContentSecurityPolicy}):
 * it needs the asset origin (jsDelivr by default) in `script-src` / `style-src`
 * and `connect-src 'self'` so the component can `fetch` the spec. The spec URL
 * and configuration are embedded with `<`-escaped JSON so an attacker-controlled
 * value cannot break out of the inline `<script>`.
 *
 * @since 0.42.0
 */
export function asyncapiHtml(opts: AsyncApiHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "AsyncAPI");
  const scriptUrl = escapeHtml(
    opts.assets?.asyncapiScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/@asyncapi/react-component/browser/standalone/index.js`,
  );
  const styleUrl = escapeHtml(
    opts.assets?.asyncapiStyleUrl ??
      `${JSDELIVR_ORIGIN}/npm/@asyncapi/react-component/styles/default.min.css`,
  );
  const scriptSri = integrityAttr(
    opts.assets?.asyncapiScriptIntegrity,
    opts.assets?.crossOrigin,
  );
  const styleSri = integrityAttr(
    opts.assets?.asyncapiStyleIntegrity,
    opts.assets?.crossOrigin,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const specArg = jsonForScript(opts.specUrl);
  const configArg = jsonForScript(
    opts.configuration ?? { show: { sidebar: true, errors: true } },
  );
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${styleUrl}"${styleSri} />
</head><body>
<div id="asyncapi"></div>
<script src="${scriptUrl}"${scriptSri}${nonce}></script>
<script${nonce}>AsyncApiStandalone.render({schema:{url:${specArg},options:{method:"GET"}},config:${configArg}},document.getElementById("asyncapi"));</script>
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
  const connectSrc = ["'self'", ...(opts.connectOrigins ?? [])];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data: https:",
    `connect-src ${connectSrc.join(" ")}`,
  ];
  // Redoc spawns a Web Worker from a `blob:` URL; without an explicit
  // worker-src the browser falls back to script-src, which forbids `blob:`
  // and breaks the page. Scope this relaxation to callers that opt in.
  if (opts.allowBlobWorkers) directives.push("worker-src 'self' blob:");

  return directives.join("; ");
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
          connectOrigins: opts.connectOrigins,
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

/**
 * Serialize a value as a JSON literal safe to embed inside an inline
 * `<script>` element. `JSON.stringify` already escapes quotes and backslashes;
 * we additionally escape `<` (so `</script>`, `<!--`, and `<script` can't end
 * or reopen the script) and the U+2028/U+2029 line separators that are illegal
 * in older JS string literals. The result is valid JSON *and* valid JS.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<\u2028\u2029]/g,
    (c) => ({ "<": "\\u003c", "\u2028": "\\u2028", "\u2029": "\\u2029" })[c]!,
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
