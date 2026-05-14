/**
 * Framework error model.
 *
 * Wire format follows RFC 9457 (application/problem+json) so clients
 * across teams and languages have a predictable, OpenAPI-documentable
 * error shape.
 *
 * Production-mode rendering scrubs `detail` for 5xx responses so internal
 * messages never leak to clients (security: information disclosure).
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Validation issues, our extension. */
  errors?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

export interface ProblemRenderOptions {
  /** When true, scrub `detail` for 5xx responses. Default: NODE_ENV === "production". */
  production?: boolean;
  /** Optional request id to embed for correlation. */
  requestId?: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    problem: Partial<ProblemDetails> & { title: string },
    headers?: Record<string, string>
  ) {
    super(problem.title);
    this.name = "HttpError";
    this.status = status;
    this.problem = {
      type: problem.type ?? `https://httpstatuses.io/${status}`,
      ...problem,
      title: problem.title,
      status,
    };
    if (headers) this.headers = headers;
  }

  toResponse(opts: ProblemRenderOptions = {}): Response {
    const isProd =
      opts.production ??
      (typeof process !== "undefined" && process.env?.NODE_ENV === "production");
    const out: ProblemDetails = { ...this.problem };
    if (isProd && this.status >= 500) {
      delete out.detail; // do not leak internals
    }
    if (opts.requestId) out.instance = `urn:request:${opts.requestId}`;
    const headers: Record<string, string> = {
      "content-type": "application/problem+json",
      ...(this.headers ?? {}),
    };
    return new Response(JSON.stringify(out), { status: this.status, headers });
  }
}

export class BadRequestError extends HttpError {
  constructor(detail?: string) {
    super(400, {
      type: "https://daloyjs.dev/errors/bad-request",
      title: "Bad Request",
      ...(detail ? { detail } : {}),
    });
    this.name = "BadRequestError";
  }
}

export class ValidationError extends HttpError {
  constructor(
    where: "params" | "query" | "headers" | "body",
    issues: Array<{ path: string; message: string }>
  ) {
    super(422, {
      type: "https://daloyjs.dev/errors/validation",
      title: "Request validation failed",
      detail: `Invalid ${where}`,
      errors: issues,
    });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(detail?: string) {
    super(404, {
      type: "https://daloyjs.dev/errors/not-found",
      title: "Not Found",
      ...(detail ? { detail } : {}),
    });
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(detail?: string) {
    super(401, {
      type: "https://daloyjs.dev/errors/unauthorized",
      title: "Unauthorized",
      ...(detail ? { detail } : {}),
    });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(detail?: string) {
    super(403, {
      type: "https://daloyjs.dev/errors/forbidden",
      title: "Forbidden",
      ...(detail ? { detail } : {}),
    });
    this.name = "ForbiddenError";
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(allow: string[]) {
    super(
      405,
      {
        type: "https://daloyjs.dev/errors/method-not-allowed",
        title: "Method Not Allowed",
      },
      { allow: allow.join(", ") }
    );
    this.name = "MethodNotAllowedError";
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(limit: number) {
    super(413, {
      type: "https://daloyjs.dev/errors/payload-too-large",
      title: "Payload Too Large",
      detail: `Body exceeds ${limit} bytes`,
    });
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(got: string, expected: string[]) {
    super(415, {
      type: "https://daloyjs.dev/errors/unsupported-media-type",
      title: "Unsupported Media Type",
      detail: `Got "${got}", expected one of: ${expected.join(", ")}`,
    });
    this.name = "UnsupportedMediaTypeError";
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(retryAfterSeconds?: number) {
    super(
      429,
      {
        type: "https://daloyjs.dev/errors/too-many-requests",
        title: "Too Many Requests",
      },
      retryAfterSeconds !== undefined
        ? { "retry-after": String(retryAfterSeconds) }
        : undefined
    );
    this.name = "TooManyRequestsError";
  }
}

export class RequestTimeoutError extends HttpError {
  constructor(ms: number) {
    super(408, {
      type: "https://daloyjs.dev/errors/request-timeout",
      title: "Request Timeout",
      detail: `Request exceeded ${ms}ms`,
    });
    this.name = "RequestTimeoutError";
  }
}

export class InternalError extends HttpError {
  constructor(detail?: string) {
    super(500, {
      type: "https://daloyjs.dev/errors/internal",
      title: "Internal Server Error",
      ...(detail ? { detail } : {}),
    });
    this.name = "InternalError";
  }
}
