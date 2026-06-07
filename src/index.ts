export { App } from "./app.js";
export { createApp } from "./app.js";
export { _resetPackageJsonCacheForTests } from "./app.js";
export { _resetCrashHandlersForTests } from "./app.js";
export { _resetInsecureDefaultsLogForTests } from "./app.js";
export type {
  AppOptions,
  AppOpenAPIOptions,
  DocsRouteOptions,
  HealthRouteOptions,
  CspReportRouteOptions,
  MetricsRouteOptions,
  IntrospectedRoute,
  PluginInstalledEvent,
  PluginExtension,
  ShutdownEvent,
  SecurityPreset,
} from "./app.js";
export {
  getConnInfo,
  setConnInfo,
  assertBehindProxy,
  resolveClientIp,
  readRemoteAddress,
  readRemotePort,
  pickForwardedForByHops,
} from "./conn-info.js";
export type { BehindProxyConfig, ConnInfo } from "./conn-info.js";
export {
  subdomains,
  PSL_SNAPSHOT_DATE,
  PSL_PUBLIC_SUFFIXES,
  MAX_SNAPSHOT_AGE_DAYS,
} from "./subdomains.js";
export type { SubdomainsOptions, SubdomainsResult } from "./subdomains.js";
export { defineDependency, DEPENDENCY_MARKER } from "./dependency.js";
export type {
  DependencyHooks,
  DependencyOptions,
} from "./dependency.js";

export type {
  RouteDefinition,
  HttpMethod,
  PathString,
  RequestSchemas,
  ResponsesMap,
  ResponseSpec,
  AuthSpec,
  Hooks,
  BaseContext,
  AppState,
  AuthScheme,
  AuthContext,
  HandlerReturn,
  InferRequest,
  ParamsOf,
  PathParams,
  CallbackDefinition,
  CallbackMap,
  CallbackOperation,
  RouteExample,
  RouteMeta,
} from "./types.js";

export {
  HttpError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  PayloadTooLargeError,
  RequestHeaderFieldsTooLargeError,
  UnsupportedMediaTypeError,
  TooManyRequestsError,
  RequestTimeoutError,
  InternalError,
  MessageLeakError,
  httpError,
  SAFE_CUSTOM_ERROR_RESPONSE_HEADERS,
  checkCustomErrorResponseHeaders,
} from "./errors.js";
export type { ProblemDetails, ProblemRenderOptions, HttpErrorOptions } from "./errors.js";

export type { StandardSchemaV1 } from "./schema.js";
export { validate, isStandardSchema } from "./schema.js";
export { diffOpenAPI, hasBreakingChanges } from "./openapi-diff.js";
export type {
  ChangeSeverity,
  OpenAPIChange,
  OpenAPIDiffResult,
} from "./openapi-diff.js";

export {
  readBodyLimited,
  safeJsonParse,
  isForbiddenObjectKey,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  timingSafeEqual,
  randomId,
  assertNoDuplicateSingletonHeaders,
  assertNoReservedInternalHeaders,
  assertHeaderCountWithinLimit,
  DEFAULT_MAX_HEADER_COUNT,
  RESERVED_INBOUND_HEADER_PREFIXES,
  SMUGGLING_SINGLETON_HEADERS,
  verifyWebhookSignature,
  signWebhookPayload,
  WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  assertStrongSecret,
  MIN_PROD_SECRET_BYTES,
  WEAK_SECRET_STRINGS,
  sanitizeFilename,
  assertSafeRelativePath,
  hasMongoOperatorKeys,
  assertNoMongoOperators,
} from "./security.js";
export type { WebhookHmacAlgorithm } from "./security.js";

export {
  requestId,
  secureHeaders,
  SECURE_HEADERS_MARKER,
  cors,
  CORS_HOOK_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  CORS_WILDCARD_ORIGIN_MARKER,
  rateLimit,
  loginThrottle,
  timing,
  bearerAuth,
  basicAuth,
  csrf,
  CSRF_HOOK_MARKER,
  fetchMetadata,
  requireScopes,
  REQUIRE_SCOPES_AGGREGATE_KEY,
  REQUIRE_SCOPES_HOOK_MARKER,
  _resetSharedRateLimitStoresForTests,
} from "./middleware.js";
export { etag } from "./etag.js";
export type { ETagOptions } from "./etag.js";
export {
  compression,
  COMPRESSION_HOOK_MARKER,
  _resetCompressionRuntimeProbeForTests,
} from "./compression.js";
export type {
  CompressionEncoding,
  CompressionOptions,
} from "./compression.js";
export {
  createJwtSigner,
  createJwtVerifier,
  JwtError,
  DEFAULT_JWT_MAX_LIFETIME_SECONDS,
} from "./jwt.js";
export type {
  JwtAlgorithm,
  JwtKeyMaterial,
  JwtSignerOptions,
  JwtVerifierOptions,
  JwtVerified,
} from "./jwt.js";
export { jwk } from "./jwk.js";
export type {
  JwkAlgorithm,
  JwkOptions,
  JwkSet,
  JwkSource,
  JwkVerifyHook,
} from "./jwk.js";
export {
  serializeCookie,
  serializeClearCookie,
  assertCookieAttributes,
  readRequestCookie,
} from "./cookie.js";
export type { CookieAttributes, CookieSameSite } from "./cookie.js";
export {
  assertTemporalClaims,
  TemporalClaimError,
} from "./time-claims.js";
export type {
  TemporalClaims,
  TemporalClaimErrorCode,
  AssertTemporalClaimsOptions,
} from "./time-claims.js";
export { every, some, except } from "./combine.js";
export type { ExceptPredicate } from "./combine.js";
export { ipRestriction } from "./ip-restriction.js";
export type { IpRestrictionOptions } from "./ip-restriction.js";
export { fetchGuard, SsrfBlockedError } from "./fetch-guard.js";
export type { FetchGuardOptions, SsrfBlockReason } from "./fetch-guard.js";
export {
  resilientFetch,
  CircuitBreaker,
  CircuitOpenError,
  FetchTimeoutError,
} from "./fetch-resilience.js";
export type {
  ResilientFetchOptions,
  CircuitBreakerOptions,
  CircuitState,
  RetryContext,
} from "./fetch-resilience.js";
export {
  createWebhookSender,
  MemoryWebhookDeadLetterSink,
} from "./webhook-delivery.js";
export type {
  WebhookEvent,
  WebhookSenderOptions,
  WebhookDeliveryResult,
  WebhookDeadLetter,
  WebhookDeadLetterSink,
  WebhookAttempt,
} from "./webhook-delivery.js";
export {
  Scheduler,
  CronParseError,
  parseCron,
  nextCronRun,
} from "./scheduler.js";
export type {
  SchedulerOptions,
  SchedulerLogger,
  TimerFns,
  TaskDefinition,
  TaskHandler,
  TaskRunContext,
  TaskErrorInfo,
  TaskState,
  CronFields,
} from "./scheduler.js";
export {
  clientCertAuth,
  setClientCertificate,
  getClientCertificate,
  normalizePeerCertificate,
  parseForwardedClientCert,
} from "./mtls.js";
export type {
  ClientCertificate,
  ClientCertificateSource,
  ClientCertAuthOptions,
  ClientCertHeaderConfig,
  PeerCertificateLike,
} from "./mtls.js";
export {
  signMessage,
  signRequest,
  verifyMessage,
  verifyRequest,
  httpSignatureAuth,
  contentDigest,
  verifyContentDigest,
  DEFAULT_SIGNATURE_LABEL,
  DEFAULT_MAX_SIGNATURE_AGE_SECONDS,
  DEFAULT_SIGNATURE_CLOCK_SKEW_SECONDS,
} from "./http-signatures.js";
export type {
  HttpSignatureAlgorithm,
  HttpSignatureKeyMaterial,
  HttpSignatureKey,
  SignMessageOptions,
  SignRequestOptions,
  MessageSignature,
  VerifyMessageOptions,
  VerifyResult,
  VerifySuccess,
  VerifyFailure,
  KeyResolutionInfo,
  HttpSignatureAuthOptions,
  ContentDigestAlgorithm,
} from "./http-signatures.js";
export {
  autoBan,
  MemoryAutoBanStore,
  _resetAutoBanStoresForTests,
} from "./auto-ban.js";
export type {
  AutoBanOptions,
  AutoBanStore,
  AutoBanRecord,
  AutoBanEvent,
  AutoBanStrikeEvent,
} from "./auto-ban.js";
export { botGuard, GOOGLEBOT, BINGBOT, WELL_KNOWN_BOTS } from "./bot-guard.js";
export type {
  BotGuardOptions,
  BotGuardEvent,
  BotResolver,
  VerifiedBotRule,
} from "./bot-guard.js";
export { ipReputation, urlFeed } from "./ip-reputation.js";
export type {
  IpReputationOptions,
  IpReputationFeed,
  IpReputationMatch,
  IpReputationController,
  UrlFeedOptions,
} from "./ip-reputation.js";
export { geoBlock } from "./geo-block.js";
export type {
  GeoBlockOptions,
  GeoBlockDecision,
  GeoBlockReason,
  GeoState,
  CountryFromIp,
  CountryFromContext,
} from "./geo-block.js";
export { concurrencyLimit } from "./concurrency-limit.js";
export type {
  ConcurrencyLimitOptions,
  ConcurrencyRejection,
} from "./concurrency-limit.js";
export {
  requestDecompression,
  decompressRequestBody,
  DecompressionBombError,
  UnsupportedContentEncodingError,
  MalformedCompressedBodyError,
  _resetRequestDecompressionProbeForTests,
} from "./request-decompression.js";
export type {
  RequestDecompressionOptions,
  RequestDecompressionEncoding,
  DecompressionBombInfo,
} from "./request-decompression.js";
export { waf } from "./waf.js";
export type {
  WafOptions,
  WafMode,
  WafRuleId,
  WafRuleConfig,
  WafInspectConfig,
  WafMatch,
  WafEvent,
  WafInspectionLocation,
} from "./waf.js";
export { safeRedirect, OpenRedirectBlockedError } from "./safe-redirect.js";
export type {
  SafeRedirectOptions,
  SafeRedirectStatus,
  SafeRedirectBlockReason,
} from "./safe-redirect.js";
export { loadShedding, LOAD_SHEDDING_MARKER } from "./load-shedding.js";
export type {
  LoadSheddingOptions,
  LoadSheddingSnapshot,
} from "./load-shedding.js";
export { defineConfig, ConfigValidationError } from "./config.js";
export type {
  ConfigSource,
  DefineConfigOptions,
} from "./config.js";
export type {
  RequestIdOptions,
  SecureHeadersOptions,
  CspDirectivesOptions,
  CorsOptions,
  CorsOriginAllow,
  RateLimitOptions,
  RateLimitStore,
  LoginThrottleOptions,
  CsrfOptions,
  CsrfCookieOptions,
  FetchMetadataOptions,
  BasicAuthOptions,
} from "./middleware.js";
export type { BearerAuthOptions, BearerAuthVerifyHook } from "./middleware.js";

export { createLogger, noopLogger, DEFAULT_REDACT_KEYS } from "./logger.js";
export type {
  Logger,
  LogLevel,
  ConsoleLoggerOptions,
  LoggerRedactionOptions,
} from "./logger.js";

export type {
  ScalarJsonPrimitive,
  ScalarJsonValue,
  ScalarReferenceConfiguration,
  ScalarTheme,
  DocsAssetOptions,
} from "./docs.js";

export { formatStartupBanner, printStartupBanner } from "./banner.js";
export type { StartupBannerLink, StartupBannerOptions } from "./banner.js";

export {
  sseStream,
  sseResponse,
  ndjsonStream,
  ndjsonResponse,
} from "./streaming.js";
export type {
  SSEMessage,
  StreamOptions,
  SSEStreamOptions,
  SSEResponseOptions,
  NDJSONResponseOptions,
} from "./streaming.js";

export {
  httpBearerScheme,
  httpBasicScheme,
  apiKeyScheme,
  oauth2Scheme,
  openIdConnectScheme,
  REQUIRE_PAYLOAD_AUTH_EXTENSION,
  securitySchemeRequiresPayloadAuth,
  toOpenAPISecurityScheme,
} from "./security-schemes.js";
export type {
  ApiKeyLocation,
  ApiKeyScheme,
  ApiKeySchemeOptions,
  HttpBasicScheme,
  HttpBasicSchemeOptions,
  HttpBearerScheme,
  HttpBearerSchemeOptions,
  OAuth2AuthorizationCodeFlow,
  OAuth2ClientCredentialsFlow,
  OAuth2Flows,
  OAuth2ImplicitFlow,
  OAuth2PasswordFlow,
  OAuth2Scheme,
  OAuth2SchemeOptions,
  OpenIdConnectScheme,
  OpenIdConnectSchemeOptions,
  SecurityScheme,
  RequirePayloadAuthExtension,
} from "./security-schemes.js";

export { discriminator, discriminatedUnion } from "./discriminator.js";
export type {
  DiscriminatorObject,
  DiscriminatedUnion,
  DiscriminatedUnionOptions,
} from "./discriminator.js";

export {
  session,
  rotateSession,
  signValue,
  verifySignedValue,
  MemorySessionStore,
  SESSION_HOOK_MARKER,
  SESSION_SECRETS_MARKER,
} from "./session.js";
export type {
  SessionOptions,
  SessionCookieOptions,
  SessionContext,
  SessionRecord,
  SessionStore,
  SessionState,
  RotateSessionOptions,
} from "./session.js";

export {
  idempotency,
  MemoryIdempotencyStore,
  _resetSharedIdempotencyStoresForTests,
} from "./idempotency.js";
export type {
  IdempotencyOptions,
  IdempotencyStore,
  IdempotencyRecord,
  StoredIdempotentResponse,
} from "./idempotency.js";

export {
  responseCache,
  MemoryResponseCacheStore,
  _resetSharedResponseCacheStoresForTests,
} from "./response-cache.js";
export type {
  ResponseCacheOptions,
  ResponseCacheStore,
  CachedResponse,
} from "./response-cache.js";

export {
  encodeCursor,
  decodeCursor,
  buildLinkHeader,
  buildPageLinks,
  paginationQuery,
  MAX_CURSOR_LENGTH,
} from "./pagination.js";
export type {
  PaginationLink,
  PageLinkOptions,
  PageLinks,
  PaginationQueryOptions,
  PaginationParams,
  PaginationQuerySchema,
} from "./pagination.js";

export {
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  httpMetrics,
  DEFAULT_DURATION_BUCKETS,
  PROMETHEUS_CONTENT_TYPE,
} from "./metrics.js";
export type {
  MetricLabels,
  MetricsRegistryOptions,
  HttpMetricsOptions,
} from "./metrics.js";


export {
  fileField,
  multipartObject,
  isFileFieldSchema,
  isMultipartObjectSchema,
} from "./multipart.js";
export type {
  FileFieldSchema,
  FileFieldOptions,
  FileMagicBytesOption,
  FileMagicBytesSignature,
  MultipartObjectOptions,
  MultipartShape,
  UploadedFile,
} from "./multipart.js";

export {
  otelTracing,
  TRACING_SPAN_KIND_SERVER,
  TRACING_SPAN_STATUS_UNSET,
  TRACING_SPAN_STATUS_OK,
  TRACING_SPAN_STATUS_ERROR,
} from "./tracing.js";
export type {
  OtelTracingOptions,
  TracingAttributes,
  TracingAttributeValue,
  TracingSpan,
  TracingStartSpanOptions,
  TracingTracer,
} from "./tracing.js";

export {
  defineWebSocket,
  WebSocketRegistry,
  WebSocketProtocolError,
  WebSocketPayloadTooLargeError,
  WS_GUID,
  WS_READY_STATE,
  WS_OPCODE,
  WS_CLOSE_CODE,
  WS_MAX_CONTROL_PAYLOAD,
  DEFAULT_WS_BACKPRESSURE_LIMIT,
  DEFAULT_WS_MAX_PAYLOAD_LENGTH,
  DEFAULT_WS_IDLE_TIMEOUT_SECONDS,
  computeAcceptKey,
  parseSubprotocols,
  validateSelectedSubprotocol,
  validateUpgrade,
  checkWebSocketOrigin,
  parseFrame,
  encodeFrame,
  encodeClosePayload,
  decodeClosePayload,
  encodeSendPayload,
  normalizeWebSocketOptions,
  wsRateLimit,
  FrameSink,
  FRAME_INCOMPLETE,
} from "./websocket.js";
export type {
  WebSocketConnection,
  WebSocketContext,
  WebSocketHandler,
  WebSocketMeta,
  WebSocketRouteEntry,
  NormalizedWebSocketOptions,
  WebSocketBeforeUpgrade,
  HandshakeResult,
  ParsedFrame,
  MessageEvent as WebSocketMessageEvent,
  FrameSinkEvents,
} from "./websocket.js";
