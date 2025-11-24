/**
 * PrintFarm Cloud - Logger Middleware
 *
 * Request logging with timing, request IDs, and structured output.
 */

import type { MiddlewareHandler, HonoRequest } from "hono";
import type { HonoEnv } from "../types/env";
import { generateShortId } from "../lib/crypto";

// =============================================================================
// LOGGER MIDDLEWARE
// =============================================================================

/**
 * Request logging middleware
 * Logs request start and completion with timing information
 */
export function loggerMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // Generate request ID
    const requestId = c.req.header("X-Request-ID") ?? generateShortId();
    c.set("requestId", requestId);
    c.set("requestStartTime", Date.now());

    // Set request ID in response header
    c.header("X-Request-ID", requestId);

    // Log request start (only in development for verbose logging)
    if (c.env.ENVIRONMENT === "development") {
      console.log(formatRequestLog(c.req, requestId, "START"));
    }

    // Execute request
    await next();

    // Calculate duration
    const startTime = c.get("requestStartTime") ?? Date.now();
    const duration = Date.now() - startTime;

    // Log request completion
    console.log(formatResponseLog(c.req, c.res, requestId, duration));
  };
}

// =============================================================================
// LOG FORMATTING
// =============================================================================

/**
 * Format request log entry
 */
function formatRequestLog(
  req: HonoRequest,
  requestId: string,
  phase: "START" | "END"
): string {
  return JSON.stringify({
    phase,
    requestId,
    method: req.method,
    path: req.path,
    query: req.query() ? JSON.stringify(req.query()) : undefined,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Format response log entry
 */
function formatResponseLog(
  req: HonoRequest,
  res: Response,
  requestId: string,
  duration: number
): string {
  return JSON.stringify({
    requestId,
    method: req.method,
    path: req.path,
    status: res.status,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
  });
}

// =============================================================================
// SIMPLE LOGGER (for non-request logging)
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

/**
 * Simple logger utility for structured logging
 * Note: In Workers, we always log debug in dev. Use environment from context when available.
 */
export const logger = {
  debug(message: string, data?: Record<string, unknown>, requestId?: string) {
    // In Workers, we log debug messages - filter at log aggregator if needed
    console.log(formatLogEntry("debug", message, data, requestId));
  },

  info(message: string, data?: Record<string, unknown>, requestId?: string) {
    console.log(formatLogEntry("info", message, data, requestId));
  },

  warn(message: string, data?: Record<string, unknown>, requestId?: string) {
    console.warn(formatLogEntry("warn", message, data, requestId));
  },

  error(message: string, data?: Record<string, unknown>, requestId?: string) {
    console.error(formatLogEntry("error", message, data, requestId));
  },
};

/**
 * Format a log entry as JSON
 */
function formatLogEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  requestId?: string
): string {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (data) {
    entry.data = data;
  }

  if (requestId) {
    entry.requestId = requestId;
  }

  return JSON.stringify(entry);
}

// =============================================================================
// CONTEXT-AWARE LOGGER
// =============================================================================

/**
 * Create a logger instance bound to a specific request context
 */
export function createContextLogger(requestId?: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      logger.debug(message, data, requestId);
    },
    info(message: string, data?: Record<string, unknown>) {
      logger.info(message, data, requestId);
    },
    warn(message: string, data?: Record<string, unknown>) {
      logger.warn(message, data, requestId);
    },
    error(message: string, data?: Record<string, unknown>) {
      logger.error(message, data, requestId);
    },
  };
}
