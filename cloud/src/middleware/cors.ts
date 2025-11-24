/**
 * PrintFarm Cloud - CORS Middleware
 *
 * Handles Cross-Origin Resource Sharing for the API.
 */

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../types/env";

/**
 * Allowed origins for CORS
 * In production, this should be restricted to known domains
 */
const ALLOWED_ORIGINS = [
  // Local development
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  // Cloudflare Pages preview URLs
  /\.pages\.dev$/,
  // Production domains (add your actual domains here)
  /\.printfarm\.app$/,
];

/**
 * Check if an origin is allowed
 */
function isAllowedOrigin(origin: string): boolean {
  for (const allowed of ALLOWED_ORIGINS) {
    if (typeof allowed === "string") {
      if (origin === allowed) return true;
    } else if (allowed instanceof RegExp) {
      if (allowed.test(origin)) return true;
    }
  }
  return false;
}

/**
 * CORS middleware with environment-aware configuration
 */
export function corsMiddleware(): MiddlewareHandler<HonoEnv> {
  return cors({
    origin: (origin, c) => {
      // In development, allow all origins
      if (c.env.ENVIRONMENT === "development") {
        return origin;
      }

      // In production, check against allowed list
      if (origin && isAllowedOrigin(origin)) {
        return origin;
      }

      // Reject unknown origins in production
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Tenant-ID",
      "X-Request-ID",
    ],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 86400, // 24 hours
    credentials: true,
  });
}

/**
 * Simple CORS middleware that allows all origins (for development only)
 */
export function devCorsMiddleware(): MiddlewareHandler<HonoEnv> {
  return cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Tenant-ID", "X-Request-ID"],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86400,
  });
}
