/**
 * Auth Routes - Better Auth Integration
 *
 * This module mounts Better Auth's handler and provides additional
 * custom auth endpoints for tenant management.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { createAuth } from "../lib/auth";
import { ApiError } from "../middleware/errors";
import {
  registerRateLimit,
  signInRateLimitByIP,
  passwordResetRateLimit,
} from "../middleware/rate-limit";

export const auth = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
  company_name: z.string().min(1).max(100).optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a random ID for database records
 */
function generateId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let id = "";
  const array = new Uint8Array(21);
  crypto.getRandomValues(array);
  for (let i = 0; i < 21; i++) {
    id += chars[array[i]! % chars.length];
  }
  return id;
}

/**
 * Generate a subdomain from user email
 */
function generateSubdomainFromEmail(email: string): string {
  const localPart = email.split("@")[0] || "user";
  let subdomain = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 24);

  if (subdomain.length < 3) {
    subdomain = subdomain + "-" + generateId().substring(0, 6);
  }

  // Add random suffix to ensure uniqueness
  subdomain = subdomain + "-" + generateId().substring(0, 4);

  return subdomain.substring(0, 32);
}

/**
 * Hash password using PBKDF2 (same algorithm Better Auth uses)
 * Format: salt:hash (both base64 encoded)
 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );

  // Convert to base64 for storage
  const saltBase64 = btoa(String.fromCharCode(...salt));
  const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hash)));

  return `${saltBase64}:${hashBase64}`;
}

/**
 * Generate a secure session token
 */
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/v1/auth/register
 *
 * Custom registration endpoint that atomically creates:
 * 1. User record
 * 2. Account record (with hashed password)
 * 3. Tenant record
 * 4. Tenant membership record (as owner)
 * 5. Session record
 *
 * This ensures a user ALWAYS has a tenant - no race conditions, no fallbacks.
 *
 * Rate limited: 5 registrations per IP per hour
 */
auth.post("/register", registerRateLimit, async (c) => {
  // Parse and validate request body
  let body: z.infer<typeof registerSchema>;
  try {
    const rawBody = await c.req.json();
    body = registerSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(
        error.errors.map((e) => e.message).join(", "),
        400,
        "VALIDATION_ERROR"
      );
    }
    throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
  }

  // Check if email already exists
  const existingUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  )
    .bind(body.email.toLowerCase())
    .first();

  if (existingUser) {
    throw new ApiError(
      "An account with this email already exists",
      409,
      "EMAIL_EXISTS"
    );
  }

  // Generate all IDs upfront
  const userId = generateId();
  const accountId = generateId();
  const tenantId = generateId();
  const memberId = generateId();
  const sessionId = generateId();
  const sessionToken = generateSessionToken();
  const now = new Date().toISOString();

  // Calculate session expiry (7 days from now)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Hash password
  const passwordHash = await hashPassword(body.password);

  // Generate tenant details
  const subdomain = generateSubdomainFromEmail(body.email);
  const companyName = body.company_name || `${body.name}'s Organization`;

  // Get request metadata for session
  const ipAddress = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const userAgent = c.req.header("User-Agent") || "unknown";

  // Execute all inserts atomically using D1 batch
  // If ANY statement fails, the entire batch is rolled back
  try {
    await c.env.DB.batch([
      // 1. Create user
      c.env.DB.prepare(
        `INSERT INTO users (id, email, full_name, is_active, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      ).bind(userId, body.email.toLowerCase(), body.name, now, now),

      // 2. Create account (stores password for credential provider)
      c.env.DB.prepare(
        `INSERT INTO accounts (id, user_id, provider_id, account_id, password, created_at, updated_at)
         VALUES (?, ?, 'credential', ?, ?, ?, ?)`
      ).bind(accountId, userId, body.email.toLowerCase(), passwordHash, now, now),

      // 3. Create tenant
      c.env.DB.prepare(
        `INSERT INTO tenants (id, subdomain, company_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      ).bind(tenantId, subdomain, companyName, now, now),

      // 4. Create tenant membership (user is owner)
      c.env.DB.prepare(
        `INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active, accepted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'owner', 1, ?, ?, ?)`
      ).bind(memberId, tenantId, userId, now, now, now),

      // 5. Create session
      c.env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(sessionId, userId, sessionToken, expiresAt, ipAddress, userAgent, now, now),
    ]);
  } catch (error) {
    console.error("[Auth] Registration batch failed:", error);

    // Check for specific constraint violations
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      if (error.message.includes("subdomain")) {
        throw new ApiError(
          "Registration failed - please try again",
          409,
          "SUBDOMAIN_CONFLICT"
        );
      }
      throw new ApiError(
        "An account with this email already exists",
        409,
        "EMAIL_EXISTS"
      );
    }

    throw new ApiError(
      "Registration failed - please try again",
      500,
      "REGISTRATION_FAILED"
    );
  }

  console.log(
    `[Auth] Registered user ${userId} with tenant ${tenantId} (atomic)`
  );

  // Set session cookie
  // Better Auth uses a specific cookie format - we'll match it
  // Add Secure flag in production to prevent transmission over HTTP
  const isProduction = c.env.ENVIRONMENT === 'production';
  const secureFlag = isProduction ? '; Secure' : '';
  const cookieValue = `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${7 * 24 * 60 * 60}`;

  // Return success with user and tenant info
  return c.json(
    {
      success: true,
      data: {
        user: {
          id: userId,
          email: body.email.toLowerCase(),
          name: body.name,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: sessionId,
          userId: userId,
          expiresAt: expiresAt,
          // Token is set via HTTP-only cookie, not exposed in response body for security
        },
        tenant: {
          id: tenantId,
          subdomain: subdomain,
          company_name: companyName,
          role: "owner",
        },
      },
    },
    201,
    {
      "Set-Cookie": cookieValue,
    }
  );
});

/**
 * Block Better Auth sign-up endpoint
 *
 * This endpoint is blocked to prevent users from registering without a tenant.
 * All registrations MUST go through POST /register for atomic tenant creation.
 */
auth.post("/sign-up/email", (c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "USE_REGISTER_ENDPOINT",
        message: "Registration via this endpoint is disabled. Use POST /api/v1/auth/register instead.",
      },
    },
    400
  );
});

/**
 * POST /api/v1/auth/sign-in/email - Login with email/password
 *
 * Rate limited: 10 per IP per minute to prevent brute force attacks
 */
auth.post("/sign-in/email", signInRateLimitByIP, async (c) => {
  const authInstance = createAuth(c.env);
  return authInstance.handler(c.req.raw);
});

/**
 * POST /api/v1/auth/forget-password - Request password reset
 *
 * Rate limited: 3 per IP per hour to prevent email enumeration and spam
 */
auth.post("/forget-password", passwordResetRateLimit, async (c) => {
  const authInstance = createAuth(c.env);
  return authInstance.handler(c.req.raw);
});

/**
 * Better Auth Handler
 *
 * Handles all other Better Auth endpoints:
 * - POST /api/v1/auth/sign-out - Logout
 * - GET  /api/v1/auth/session - Get current session
 * - POST /api/v1/auth/reset-password - Reset password with token
 * - POST /api/v1/auth/change-password - Change password (authenticated)
 * - POST /api/v1/auth/change-email - Change email (authenticated)
 */
auth.on(["GET", "POST"], "/*", async (c) => {
  const authInstance = createAuth(c.env);
  return authInstance.handler(c.req.raw);
});
