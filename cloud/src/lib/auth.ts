/**
 * Better Auth Configuration for Cloudflare Workers
 *
 * Since D1 bindings are only available at request time, we create the auth
 * instance dynamically. This file provides a factory function to create
 * the auth instance with the correct D1 binding.
 *
 * NOTE: User registration should use POST /api/v1/auth/register (in routes/auth.ts)
 * which atomically creates user + tenant + membership. Do NOT use Better Auth's
 * sign-up endpoint directly as it does not handle tenant creation.
 */

import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Env } from "../types/env";
import { hashPassword, verifyPassword } from "./password";

/**
 * Create a Better Auth instance with the D1 database binding
 *
 * @param env - Cloudflare Workers environment bindings
 * @returns Better Auth instance configured for this request
 */
export function createAuth(env: Env) {
  // Validate that the secret is set
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Run: wrangler secret put BETTER_AUTH_SECRET"
    );
  }

  const db = new Kysely({
    dialect: new D1Dialect({
      database: env.DB,
    }),
  });

  return betterAuth({
    database: {
      db,
      type: "sqlite",
    },

    // Base path for auth endpoints (matches our route mounting)
    basePath: "/api/v1/auth",

    // Secret for signing tokens - MUST be set via `wrangler secret put BETTER_AUTH_SECRET`
    secret: env.BETTER_AUTH_SECRET,

    // Base URL - used for callbacks and redirects
    // Default to localhost:8787 in development if not set
    baseURL: env.BETTER_AUTH_URL || "http://localhost:8787",

    // Email and password authentication
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // Can enable later with email provider
      minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },

    // Session configuration
    session: {
      // Session expires after 7 days of inactivity
      expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
      // Update session expiry when accessed within this window
      updateAge: 60 * 60 * 24, // 1 day in seconds
      // Cookie settings for cross-origin requests
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
      // Model customization to match our schema
      modelName: "sessions",
      fields: {
        userId: "user_id",
        token: "token",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    // User model customization to match our existing schema
    user: {
      modelName: "users",
      fields: {
        name: "full_name",
        email: "email",
        emailVerified: "email_verified",
        image: "avatar_url",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        isActive: {
          type: "boolean",
          defaultValue: true,
          input: false,
          fieldName: "is_active", // Map to snake_case column
        },
        lastLogin: {
          type: "string",
          required: false,
          input: false,
          fieldName: "last_login", // Map to snake_case column
        },
      },
    },

    // Account model (for OAuth providers)
    account: {
      modelName: "accounts",
      fields: {
        userId: "user_id",
        providerId: "provider_id",
        accountId: "account_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        scope: "scope",
        idToken: "id_token",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    // Verification model (for email verification, password reset)
    verification: {
      modelName: "verifications",
      fields: {
        identifier: "identifier",
        value: "value",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    // Trusted origins for CSRF protection
    // In production, use TRUSTED_ORIGINS env var; in development, allow all localhost origins
    trustedOrigins: env.TRUSTED_ORIGINS
      ? env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
      : [
          // Common localhost development ports
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:5174",
          "http://localhost:5175",
          "http://localhost:8787",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:5173",
          "http://127.0.0.1:5174",
          "http://127.0.0.1:5175",
          "http://127.0.0.1:8787",
        ],

    // Advanced options
    advanced: {
      // In development, disable CSRF check since frontend and backend run on different ports
      // This is safe because we're on localhost; in production, CSRF check will be enabled
      disableCSRFCheck: env.ENVIRONMENT === "development",
    },

    // NOTE: Tenant creation is NOT done here anymore.
    // Use POST /api/v1/auth/register for atomic user+tenant creation.
    // The Better Auth sign-up endpoint should NOT be used directly.
  });
}

/**
 * Type export for the auth instance
 */
export type Auth = ReturnType<typeof createAuth>;
