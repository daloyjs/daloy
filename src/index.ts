export { App } from "./app.js";
export type { AppOptions, IntrospectedRoute, PluginInstalledEvent, ShutdownEvent } from "./app.js";

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
  HandlerReturn,
  InferRequest,
  ParamsOf,
  PathParams,
  CallbackDefinition,
  CallbackMap,
  CallbackOperation,
} from "./types.js";

export {
  HttpError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  TooManyRequestsError,
  RequestTimeoutError,
  InternalError,
} from "./errors.js";
export type { ProblemDetails, ProblemRenderOptions } from "./errors.js";

export type { StandardSchemaV1 } from "./schema.js";
export { validate, isStandardSchema } from "./schema.js";

export {
  readBodyLimited,
  safeJsonParse,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  timingSafeEqual,
  randomId,
} from "./security.js";

export {
  requestId,
  secureHeaders,
  cors,
  rateLimit,
  timing,
  bearerAuth,
  csrf,
} from "./middleware.js";
export type {
  RequestIdOptions,
  SecureHeadersOptions,
  CorsOptions,
  RateLimitOptions,
  RateLimitStore,
  CsrfOptions,
  CsrfCookieOptions,
} from "./middleware.js";

export { createLogger, noopLogger } from "./logger.js";
export type { Logger, LogLevel, ConsoleLoggerOptions } from "./logger.js";

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
} from "./security-schemes.js";

export { discriminator, discriminatedUnion } from "./discriminator.js";
export type {
  DiscriminatorObject,
  DiscriminatedUnion,
  DiscriminatedUnionOptions,
} from "./discriminator.js";

export {
  session,
  signValue,
  verifySignedValue,
  MemorySessionStore,
} from "./session.js";
export type {
  SessionOptions,
  SessionCookieOptions,
  SessionContext,
  SessionRecord,
  SessionStore,
  SessionState,
} from "./session.js";

export {
  fileField,
  multipartObject,
  isFileFieldSchema,
  isMultipartObjectSchema,
} from "./multipart.js";
export type {
  FileFieldSchema,
  FileFieldOptions,
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
