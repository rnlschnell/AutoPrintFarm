/**
 * Auth Middleware - Better Auth Session Validation
 *
 * Middleware to validate sessions and attach user info to request context.
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../types/env";
import { createAuth } from "../lib/auth";
import { ApiError } from "./errors";

/**
 * Session data returned by Better Auth
 */
interface Session {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image?: string;
  };
}

/**
 * Auth middleware that requires authentication
 *
 * Usage:
 * ```ts
 * app.get('/protected', requireAuth(), (c) => {
 *   const user = c.get('user');
 *   return c.json({ message: `Hello ${user.full_name}` });
 * });
 * ```
 */
export function requireAuth(): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    const authInstance = createAuth(c.env);

    try {
      const session = (await authInstance.api.getSession({
        headers: c.req.raw.headers,
      })) as Session | null;

      if (!session) {
        throw new ApiError("Unauthorized", 401, "UNAUTHORIZED");
      }

      // Attach user and session to context
      c.set("userId", session.user.id);
      c.set("user", {
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.name,
      });

      await next();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError("Unauthorized", 401, "UNAUTHORIZED");
    }
  };
}

/**
 * Optional auth middleware - attaches user if authenticated, but doesn't require it
 *
 * Usage:
 * ```ts
 * app.get('/public', optionalAuth(), (c) => {
 *   const user = c.get('user');
 *   if (user) {
 *     return c.json({ message: `Hello ${user.full_name}` });
 *   }
 *   return c.json({ message: 'Hello guest' });
 * });
 * ```
 */
export function optionalAuth(): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    const authInstance = createAuth(c.env);

    try {
      const session = (await authInstance.api.getSession({
        headers: c.req.raw.headers,
      })) as Session | null;

      if (session) {
        c.set("userId", session.user.id);
        c.set("user", {
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.name,
        });
      }
    } catch {
      // Silently ignore auth errors for optional auth
    }

    await next();
  };
}

/**
 * Get the current session for the request
 *
 * Helper function for use in route handlers
 */
export async function getSession(c: Context<HonoEnv>): Promise<Session | null> {
  const authInstance = createAuth(c.env);

  try {
    return (await authInstance.api.getSession({
      headers: c.req.raw.headers,
    })) as Session | null;
  } catch {
    return null;
  }
}
