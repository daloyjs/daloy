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
  ScalarJsonPrimitive | ScalarJsonValue[] | { [key: string]: ScalarJsonValue | undefined };

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
  /** Built-in color theme name. See {@link ScalarTheme}. */
  theme?: ScalarTheme;
  /** Extra CSS injected into the reference UI. */
  customCss?: string;
  /** Start the UI in dark mode. */
  darkMode?: boolean;
  /** Pin the color scheme and hide the user's ability to change it. */
  forceDarkModeState?: "dark" | "light";
  /** Load Scalar's default fonts (Inter/JetBrains Mono) from its CDN. */
  withDefaultFonts?: boolean;
  /** URL of the favicon shown in the browser tab. */
  favicon?: string;
  /** Overall page layout: `"modern"` (default) or `"classic"`. */
  layout?: "modern" | "classic";
  /** Hide the "Open API Client" button. */
  hideClientButton?: boolean;
  /** Hide the dark-mode toggle. */
  hideDarkModeToggle?: boolean;
  /** Hide the Models (schemas) section. */
  hideModels?: boolean;
  /** Hide the search bar. */
  hideSearch?: boolean;
  /** Hide the "Test Request" button on operations. */
  hideTestRequestButton?: boolean;
  /** Show each operation's `operationId` next to its title. */
  showOperationId?: boolean;
  /** Show the navigation sidebar. */
  showSidebar?: boolean;
  /** When to expose Scalar's developer tools panel. */
  showDeveloperTools?: "always" | "localhost" | "never";
  /** Expand the first tag's operations on load. */
  defaultOpenFirstTag?: boolean;
  /** Expand every tag's operations on load. */
  defaultOpenAllTags?: boolean;
  /** Expand all model (schema) sections on load. */
  expandAllModelSections?: boolean;
  /** Expand all response sections on load. */
  expandAllResponses?: boolean;
  /** Which spec download button(s) to offer, or `"none"` to hide them. */
  documentDownloadType?: "json" | "yaml" | "both" | "direct" | "none";
  /** Label operations by their `summary` or by their `path`. */
  operationTitleSource?: "summary" | "path";
  /** List required schema properties before optional ones. */
  orderRequiredPropertiesFirst?: boolean;
  /** Sort schema properties alphabetically or keep spec order. */
  orderSchemaPropertiesBy?: "alpha" | "preserve";
  /** Keyboard key that focuses search, e.g. `"k"` for Ctrl/Cmd+K. */
  searchHotKey?: string;
  /** Base URL prepended to relative server URLs in the spec. */
  baseServerURL?: string;
  /** Proxy URL used by "Test Request" calls to avoid CORS issues. */
  proxyUrl?: string;
  /** Redirect URI used by the OAuth2 authorization-code flow. */
  oauth2RedirectUri?: string;
  /** Persist entered credentials in browser storage across reloads. */
  persistAuth?: boolean;
  /** Enable Scalar's anonymous usage telemetry. */
  telemetry?: boolean;
  /** Sort tags alphabetically. */
  tagsSorter?: "alpha";
  /** Sort operations alphabetically or by HTTP method. */
  operationsSorter?: "alpha" | "method";
  /** Prefill security-scheme credentials (JSON-only Scalar `authentication` object). */
  authentication?: { [key: string]: ScalarJsonValue | undefined };
  /** Snippet target preselected in the client picker, e.g. `{ targetKey, clientKey }`. */
  defaultHttpClient?: { [key: string]: ScalarJsonValue | undefined };
  /** Extra HTML meta tags (title, description, Open Graph, ...) for the page. */
  metaData?: { [key: string]: ScalarJsonValue | undefined };
  /** Scalar MCP integration settings (JSON-only). */
  mcp?: { [key: string]: ScalarJsonValue | undefined };
  /** Use path-based routing for deep links, e.g. `{ basePath }`. */
  pathRouting?: { [key: string]: ScalarJsonValue | undefined };
  /** Override the spec's `servers` list shown in the UI. */
  servers?: ScalarJsonValue[];
  /** Not serializable; the spec is always loaded from {@link DocsOptions.specUrl}. */
  content?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  fetch?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  generateHeadingSlug?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  generateModelSlug?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  generateOperationSlug?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  generateTagSlug?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  generateWebhookSlug?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onBeforeRequest?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onDocumentSelect?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onLoaded?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onRequestSent?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onServerChange?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onShowMore?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onSidebarClick?: never;
  /** Function-valued callback; cannot cross the server-to-HTML boundary. */
  onSpecUpdate?: never;
  /** Function-valued Scalar plugins; cannot cross the server-to-HTML boundary. */
  plugins?: never;
  /** Function-valued option; cannot cross the server-to-HTML boundary. */
  redirect?: never;
  /** Multi-document sources are not serializable here; serve one spec per page. */
  sources?: never;
  /** Internal URL wiring owned by DaloyJS. Use {@link DocsOptions.specUrl} instead. */
  spec?: never;
  /** Internal URL wiring owned by DaloyJS. Use {@link DocsOptions.specUrl} instead. */
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

/**
 * Provider-neutral login launcher rendered into generated docs pages.
 *
 * Use this when the OpenAPI docs should expose a visible authorization control
 * that sends developers to a local login form or to an external identity
 * provider such as Entra ID, Auth0, Better Auth, Clerk, Okta, Keycloak, or any
 * other OAuth2/OIDC front end. The launcher only opens the configured URL; it
 * never stores tokens or bypasses the OpenAPI UI's normal security-scheme
 * handling.
 *
 * @since 0.43.0
 */
export interface DocsAuthLauncherOptions {
  /**
   * Absolute `http(s)` URL or same-origin/relative URL for the login or
   * authorization entry point. `javascript:`, `data:`, and other executable
   * schemes are refused when the HTML is generated.
   */
  loginUrl: string;
  /** Button text. Defaults to `"Authorize"`. */
  label?: string;
  /**
   * Accessible helper text shown as the button title and screen-reader label.
   * Defaults to `"Open login or identity provider"`.
   */
  description?: string;
  /**
   * How to open {@link DocsAuthLauncherOptions.loginUrl}. Defaults to
   * `"popup"` so docs remain open while the provider flow runs.
   */
  target?: "popup" | "_blank" | "_self";
  /** Popup width in CSS/device pixels. Defaults to `520`. */
  popupWidth?: number;
  /** Popup height in CSS/device pixels. Defaults to `720`. */
  popupHeight?: number;
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
  /**
   * Optional authorization launcher rendered into the docs page. It gives
   * Scalar, Swagger UI, and Redoc a consistent visible button that opens a
   * local login form or third-party identity-provider authorization URL.
   *
   * @since 0.43.0
   */
  auth?: DocsAuthLauncherOptions;
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
  crossOrigin: DocsAssetOptions["crossOrigin"]
): string {
  if (integrity === undefined) return "";
  const tokens = integrity.trim().split(/\s+/);
  if (integrity.trim() === "" || tokens.some((t) => !SRI_HASH.test(t))) {
    throw new TypeError(
      `Invalid Subresource Integrity value: ${JSON.stringify(integrity)}. ` +
        `Expected one or more space-separated "sha256-"/"sha384-"/"sha512-" base64 hashes.`
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
 *
 * @param opts Spec URL, page title, asset overrides, CSP nonce, and Scalar configuration.
 * @returns The complete HTML document as a string.
 * @throws {TypeError} when an SRI integrity value or `auth.loginUrl` is invalid.
 */
export function scalarHtml(opts: ScalarHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  const scriptUrl = escapeHtml(
    opts.assets?.scalarScriptUrl ?? `${JSDELIVR_ORIGIN}/npm/@scalar/api-reference`
  );
  const scriptSri = integrityAttr(opts.assets?.scalarScriptIntegrity, opts.assets?.crossOrigin);
  const nonce = nonceAttr(opts.scriptNonce);
  const configuration = scalarConfigurationAttr(opts.specUrl, opts.configuration);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"${configuration}${nonce}></script>
<script src="${scriptUrl}"${scriptSri}${nonce}></script>
${docsAuthLauncherHtml(opts.auth, opts.scriptNonce)}
</body></html>`;
}

/**
 * Render a Swagger UI HTML page that loads `opts.specUrl`. Same usage as
 * {@link scalarHtml} but emits the classic Swagger UI bundle.
 *
 * Developer-entered credentials are persisted by default
 * (`persistAuthorization: true`) so routes with OpenAPI security requirements
 * can be exercised after using Swagger UI's Authorize dialog.
 *
 * @param opts Spec URL, page title, asset overrides, CSP nonce, and Swagger UI configuration.
 * @returns The complete HTML document as a string.
 * @throws {TypeError} when an SRI integrity value or `auth.loginUrl` is invalid.
 */
export function swaggerUiHtml(opts: SwaggerUiHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const cssUrl = escapeHtml(
    opts.assets?.swaggerUiCssUrl ?? `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`
  );
  const bundleUrl = escapeHtml(
    opts.assets?.swaggerUiBundleUrl ?? `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`
  );
  const cssSri = integrityAttr(opts.assets?.swaggerUiCssIntegrity, opts.assets?.crossOrigin);
  const bundleSri = integrityAttr(opts.assets?.swaggerUiBundleIntegrity, opts.assets?.crossOrigin);
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
${docsAuthLauncherHtml(opts.auth, opts.scriptNonce)}
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
 * @param opts Spec URL, page title, asset overrides, CSP nonce, and Redoc configuration.
 * @returns The complete HTML document as a string.
 * @throws {TypeError} when an SRI integrity value or `auth.loginUrl` is invalid.
 * @since 0.39.0
 */
export function redocHtml(opts: RedocHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const scriptUrl = escapeHtml(
    opts.assets?.redocScriptUrl ?? `${JSDELIVR_ORIGIN}/npm/redoc/bundles/redoc.standalone.js`
  );
  const scriptSri = integrityAttr(opts.assets?.redocScriptIntegrity, opts.assets?.crossOrigin);
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
${docsAuthLauncherHtml(opts.auth, opts.scriptNonce)}
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
 * @param opts Spec URL, page title, asset overrides, CSP nonce, and AsyncAPI configuration.
 * @returns The complete HTML document as a string.
 * @throws {TypeError} when an SRI integrity value is invalid.
 * @since 0.42.0
 */
export function asyncapiHtml(opts: AsyncApiHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "AsyncAPI");
  const scriptUrl = escapeHtml(
    opts.assets?.asyncapiScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/@asyncapi/react-component/browser/standalone/index.js`
  );
  const styleUrl = escapeHtml(
    opts.assets?.asyncapiStyleUrl ??
      `${JSDELIVR_ORIGIN}/npm/@asyncapi/react-component/styles/default.min.css`
  );
  const scriptSri = integrityAttr(opts.assets?.asyncapiScriptIntegrity, opts.assets?.crossOrigin);
  const styleSri = integrityAttr(opts.assets?.asyncapiStyleIntegrity, opts.assets?.crossOrigin);
  const nonce = nonceAttr(opts.scriptNonce);
  const specArg = jsonForScript(opts.specUrl);
  const configArg = jsonForScript(opts.configuration ?? { show: { sidebar: true, errors: true } });
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
 *
 * @param opts Asset/connect origins, script nonce, inline-style, and blob-worker toggles.
 * @returns The policy string, ready for a `content-security-policy` header.
 */
export function docsContentSecurityPolicy(opts: DocsContentSecurityPolicyOptions = {}): string {
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
 *
 * @param html The HTML document body to serve.
 * @param opts CSP options, or a verbatim `contentSecurityPolicy` override.
 * @returns A `Response` with the HTML body and hardened security headers.
 */
export function htmlResponse(html: string, opts: HtmlResponseOptions = {}): Response {
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
          allowBlobWorkers: opts.allowBlobWorkers,
        }),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
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
    (c) => ({ "<": "\\u003c", "\u2028": "\\u2028", "\u2029": "\\u2029" })[c]!
  );
}

function docsAuthLauncherHtml(
  auth: DocsAuthLauncherOptions | undefined,
  scriptNonce: string | undefined
): string {
  if (!auth) return "";
  const loginUrl = normalizeDocsAuthLoginUrl(auth.loginUrl);
  const label = auth.label ?? "Authorize";
  const description = auth.description ?? "Open login or identity provider";
  const target = auth.target ?? "popup";
  const popupWidth = positiveIntegerOrDefault(auth.popupWidth, 520);
  const popupHeight = positiveIntegerOrDefault(auth.popupHeight, 720);
  const payload = jsonForScript({
    loginUrl,
    target,
    popupWidth,
    popupHeight,
  });
  const nonce = nonceAttr(scriptNonce);
  return `<style>
.daloy-docs-auth{position:fixed;right:16px;top:16px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;border:1px solid #1d4ed8;border-radius:6px;background:#2563eb;color:#fff;font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:10px 14px;box-shadow:0 8px 24px rgba(15,23,42,.18);cursor:pointer}
.daloy-docs-auth:focus{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}
</style>
<button type="button" class="daloy-docs-auth" data-daloy-docs-auth title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">${escapeHtml(label)}</button>
<script${nonce}>(()=>{const o=${payload};const b=document.querySelector("[data-daloy-docs-auth]");if(!b)return;b.addEventListener("click",()=>{if(o.target==="_self"){window.location.assign(o.loginUrl);return;}if(o.target==="_blank"){window.open(o.loginUrl,"_blank","noopener,noreferrer");return;}const left=Math.max(0,Math.round((window.screenX||0)+((window.outerWidth||o.popupWidth)-o.popupWidth)/2));const top=Math.max(0,Math.round((window.screenY||0)+((window.outerHeight||o.popupHeight)-o.popupHeight)/2));const features="popup=yes,width="+o.popupWidth+",height="+o.popupHeight+",left="+left+",top="+top+",noopener,noreferrer";window.open(o.loginUrl,"daloy_docs_auth",features);});})();</script>`;
}

function normalizeDocsAuthLoginUrl(loginUrl: string): string {
  if (typeof loginUrl !== "string" || loginUrl.trim() === "") {
    throw new TypeError("docs auth loginUrl must be a non-empty string");
  }
  const trimmed = loginUrl.trim();
  const parsed = new URL(trimmed, "https://daloyjs.local");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(
      `docs auth loginUrl must be an http(s) or relative URL; got ${JSON.stringify(loginUrl)}`
    );
  }
  return trimmed;
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function scalarConfigurationAttr(
  specUrl: string,
  configuration: ScalarReferenceConfiguration | undefined
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
