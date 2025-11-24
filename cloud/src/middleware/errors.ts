/**
 * PrintFarm Cloud - Error Handling Middleware
 *
 * Global error handler with structured error responses and
 * environment-aware error detail exposure.
 */

import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoEnv } from "../types/env";
import { DatabaseError, NotFoundError, UniqueConstraintError } from "../lib/db";
import { z } from "zod";

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base API error class for structured error responses
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: ContentfulStatusCode,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 400 Bad Request - Invalid input
 */
export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class ForbiddenError extends ApiError {
  constructor(message = "Insufficient permissions") {
    super(message, 403, "FORBIDDEN");
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundApiError extends ApiError {
  constructor(resource = "Resource", id?: string) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
    super(message, 404, "NOT_FOUND");
  }
}

/**
 * 409 Conflict - Resource conflict
 */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends ApiError {
  constructor(retryAfter?: number) {
    super("Rate limit exceeded", 429, "RATE_LIMIT_EXCEEDED", { retryAfter });
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalError extends ApiError {
  constructor(message = "Internal server error") {
    super(message, 500, "INTERNAL_ERROR");
  }
}

// =============================================================================
// ERROR RESPONSE FORMAT
// =============================================================================

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * Format error response
 */
function formatErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  includeStack?: string
): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details !== undefined) {
    response.error.details = details;
  }

  if (includeStack) {
    response.error.stack = includeStack;
  }

  return response;
}

// =============================================================================
// ZOD ERROR FORMATTING
// =============================================================================

/**
 * Format Zod validation errors into a readable format
 */
function formatZodError(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}

// =============================================================================
// ERROR HANDLERS
// =============================================================================

/**
 * Global error handler middleware
 */
export const errorHandler: ErrorHandler<HonoEnv> = (err, c) => {
  const isDev = c.env.ENVIRONMENT === "development";

  // Log error
  console.error("[Error]", {
    name: err.name,
    message: err.message,
    stack: isDev ? err.stack : undefined,
    requestId: c.get("requestId"),
  });

  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    return c.json(
      formatErrorResponse(
        "VALIDATION_ERROR",
        "Validation failed",
        formatZodError(err)
      ),
      422
    );
  }

  // Handle API errors (our custom errors)
  if (err instanceof ApiError) {
    return c.json(
      formatErrorResponse(
        err.code,
        err.message,
        err.details,
        isDev ? err.stack : undefined
      ),
      err.statusCode
    );
  }

  // Handle database errors
  if (err instanceof NotFoundError) {
    return c.json(formatErrorResponse("NOT_FOUND", err.message), 404);
  }

  if (err instanceof UniqueConstraintError) {
    return c.json(formatErrorResponse("CONFLICT", err.message), 409);
  }

  if (err instanceof DatabaseError) {
    return c.json(
      formatErrorResponse(
        "DATABASE_ERROR",
        isDev ? err.message : "Database operation failed",
        isDev ? { code: err.code } : undefined
      ),
      500
    );
  }

  // Handle unknown errors
  const message = isDev && err instanceof Error ? err.message : "Internal server error";
  const stack = isDev && err instanceof Error ? err.stack : undefined;

  return c.json(
    formatErrorResponse("INTERNAL_ERROR", message, undefined, stack),
    500
  );
};

/**
 * 404 Not Found handler for unmatched routes
 */
export const notFoundHandler: NotFoundHandler<HonoEnv> = (c) => {
  return c.json(
    formatErrorResponse("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`),
    404
  );
};

// =============================================================================
// ERROR THROWING HELPERS
// =============================================================================

/**
 * Assert a condition and throw BadRequestError if false
 */
export function assertBadRequest(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new BadRequestError(message);
  }
}

/**
 * Assert a value exists and throw NotFoundApiError if not
 */
export function assertFound<T>(
  value: T | null | undefined,
  resource: string,
  id?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new NotFoundApiError(resource, id);
  }
}

/**
 * Assert user is authenticated
 */
export function assertAuthenticated(
  userId: string | undefined
): asserts userId is string {
  if (!userId) {
    throw new UnauthorizedError();
  }
}

/**
 * Assert user has required role
 */
export function assertRole(
  userRole: string | undefined,
  allowedRoles: string[]
): void {
  if (!userRole || !allowedRoles.includes(userRole)) {
    throw new ForbiddenError();
  }
}
