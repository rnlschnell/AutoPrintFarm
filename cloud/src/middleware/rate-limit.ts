/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting for auth endpoints using Cloudflare KV.
 * Implements sliding window rate limiting with configurable limits.
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../types/env";
import { ApiError } from "./errors";

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Key prefix for KV storage */
  keyPrefix: string;
  /** Optional: Use account email as key (for login attempts) */
  keyByEmail?: boolean;
}

/**
 * Get client IP address from Cloudflare headers
 */
function getClientIP(c: Context<HonoEnv>): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Generate rate limit key
 */
function getRateLimitKey(
  c: Context<HonoEnv>,
  config: RateLimitConfig,
  email?: string
): string {
  const ip = getClientIP(c);

  if (config.keyByEmail && email) {
    // For sign-in, track by email to prevent brute force on specific accounts
    return `${config.keyPrefix}:email:${email.toLowerCase()}`;
  }

  return `${config.keyPrefix}:ip:${ip}`;
}

/**
 * Rate limit data structure stored in KV
 */
interface RateLimitData {
  count: number;
  windowStart: number;
}

/**
 * Check and update rate limit
 * Returns true if request should be allowed, false if rate limited
 */
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.windowSeconds;

  // Get current rate limit data
  const stored = await kv.get<RateLimitData>(key, "json");

  let data: RateLimitData;

  if (!stored || stored.windowStart < windowStart) {
    // No data or window expired, start fresh
    data = { count: 1, windowStart: now };
  } else {
    // Window still active, increment count
    data = { count: stored.count + 1, windowStart: stored.windowStart };
  }

  // Calculate when the rate limit resets
  const resetAt = data.windowStart + config.windowSeconds;
  const remaining = Math.max(0, config.maxRequests - data.count);
  const allowed = data.count <= config.maxRequests;

  // Store updated data with TTL
  await kv.put(key, JSON.stringify(data), {
    expirationTtl: config.windowSeconds,
  });

  return { allowed, remaining, resetAt };
}

/**
 * Rate limiting middleware factory
 *
 * Usage:
 * ```ts
 * // 5 requests per hour for registration
 * app.post('/register', rateLimit({ maxRequests: 5, windowSeconds: 3600, keyPrefix: 'rl:register' }), handler);
 *
 * // 10 requests per minute for login (by IP)
 * app.post('/sign-in', rateLimit({ maxRequests: 10, windowSeconds: 60, keyPrefix: 'rl:signin' }), handler);
 * ```
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    // Extract email from body if needed for email-based rate limiting
    let email: string | undefined;
    if (config.keyByEmail) {
      try {
        const body = await c.req.json();
        email = body.email;
        // Store body for later use since we consumed it
        c.set("requestBody" as keyof HonoEnv["Variables"], body);
      } catch {
        // Ignore parsing errors, will use IP-based limiting
      }
    }

    const key = getRateLimitKey(c, config, email);
    const { allowed, remaining, resetAt } = await checkRateLimit(
      c.env.KV,
      key,
      config
    );

    // Set rate limit headers
    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetAt.toString());

    if (!allowed) {
      throw new ApiError(
        `Too many requests. Please try again after ${new Date(resetAt * 1000).toISOString()}`,
        429,
        "RATE_LIMITED"
      );
    }

    await next();
  };
}

/**
 * Pre-configured rate limiters for auth endpoints
 */

/**
 * Rate limit for registration: 5 per IP per hour
 * Prevents mass account creation
 */
export const registerRateLimit = rateLimit({
  maxRequests: 5,
  windowSeconds: 3600, // 1 hour
  keyPrefix: "rl:register",
});

/**
 * Rate limit for sign-in: 10 per IP per minute
 * Prevents brute force attacks
 */
export const signInRateLimitByIP = rateLimit({
  maxRequests: 10,
  windowSeconds: 60, // 1 minute
  keyPrefix: "rl:signin:ip",
});

/**
 * Rate limit for sign-in: 5 per account per minute
 * Prevents targeted brute force on specific accounts
 */
export const signInRateLimitByEmail = rateLimit({
  maxRequests: 5,
  windowSeconds: 60, // 1 minute
  keyPrefix: "rl:signin:email",
  keyByEmail: true,
});

/**
 * Rate limit for password reset: 3 per IP per hour
 * Prevents email enumeration and spam
 */
export const passwordResetRateLimit = rateLimit({
  maxRequests: 3,
  windowSeconds: 3600, // 1 hour
  keyPrefix: "rl:password-reset",
});

/**
 * Rate limit for member invitations: 20 per tenant per hour
 * Prevents invitation spam and abuse
 */
export const memberInviteRateLimit = rateLimit({
  maxRequests: 20,
  windowSeconds: 3600, // 1 hour
  keyPrefix: "rl:member-invite",
});

/**
 * Rate limit for role changes: 30 per tenant per hour
 * Prevents rapid privilege escalation attempts
 */
export const roleChangeRateLimit = rateLimit({
  maxRequests: 30,
  windowSeconds: 3600, // 1 hour
  keyPrefix: "rl:role-change",
});

/**
 * Rate limit for member removal: 20 per tenant per hour
 * Prevents mass removal attacks
 */
export const memberRemovalRateLimit = rateLimit({
  maxRequests: 20,
  windowSeconds: 3600, // 1 hour
  keyPrefix: "rl:member-removal",
});
