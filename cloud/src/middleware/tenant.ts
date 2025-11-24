/**
 * Tenant Middleware - Multi-tenancy Support
 *
 * Middleware to extract tenant context and validate user membership.
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../types/env";
import { ApiError } from "./errors";

/**
 * Tenant membership with role information
 */
interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "operator" | "viewer";
  is_active: number;
}

/**
 * Tenant information
 */
interface Tenant {
  id: string;
  subdomain: string;
  company_name: string;
  is_active: number;
}

/**
 * Require tenant context middleware
 *
 * Extracts tenant from:
 * 1. X-Tenant-ID header
 * 2. Query parameter ?tenant_id=xxx
 *
 * Validates that the authenticated user is a member of the tenant.
 *
 * Usage:
 * ```ts
 * app.get('/printers', requireAuth(), requireTenant(), (c) => {
 *   const tenantId = c.get('tenantId');
 *   const tenant = c.get('tenant');
 *   // Query printers for this tenant
 * });
 * ```
 */
export function requireTenant(): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    const userId = c.get("userId");

    if (!userId) {
      throw new ApiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    // Extract tenant ID from header or query
    const tenantId =
      c.req.header("X-Tenant-ID") || c.req.query("tenant_id");

    if (!tenantId) {
      throw new ApiError(
        "Tenant ID required. Provide X-Tenant-ID header or tenant_id query parameter.",
        400,
        "TENANT_REQUIRED"
      );
    }

    // Validate tenant exists and is active
    const tenant = await c.env.DB.prepare(
      "SELECT id, subdomain, company_name, is_active FROM tenants WHERE id = ?"
    )
      .bind(tenantId)
      .first<Tenant>();

    if (!tenant) {
      throw new ApiError("Tenant not found", 404, "TENANT_NOT_FOUND");
    }

    if (!tenant.is_active) {
      throw new ApiError("Tenant is inactive", 403, "TENANT_INACTIVE");
    }

    // Validate user membership in tenant
    const membership = await c.env.DB.prepare(
      "SELECT id, tenant_id, user_id, role, is_active FROM tenant_members WHERE tenant_id = ? AND user_id = ?"
    )
      .bind(tenantId, userId)
      .first<TenantMember>();

    if (!membership) {
      throw new ApiError(
        "You are not a member of this tenant",
        403,
        "NOT_A_MEMBER"
      );
    }

    if (!membership.is_active) {
      throw new ApiError(
        "Your membership in this tenant is inactive",
        403,
        "MEMBERSHIP_INACTIVE"
      );
    }

    // Attach tenant info to context
    c.set("tenantId", tenantId);
    c.set("tenant", {
      id: tenant.id,
      subdomain: tenant.subdomain,
      company_name: tenant.company_name,
    });
    c.set("userRole", membership.role);

    await next();
  };
}

/**
 * Require specific roles middleware
 *
 * Use after requireTenant() to restrict access to certain roles.
 *
 * Usage:
 * ```ts
 * app.delete('/printers/:id',
 *   requireAuth(),
 *   requireTenant(),
 *   requireRoles(['owner', 'admin']),
 *   (c) => {
 *     // Only owners and admins can delete printers
 *   }
 * );
 * ```
 */
export function requireRoles(
  allowedRoles: Array<"owner" | "admin" | "operator" | "viewer">
): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    const userRole = c.get("userRole");

    if (!userRole) {
      throw new ApiError(
        "Tenant context required",
        400,
        "TENANT_CONTEXT_REQUIRED"
      );
    }

    if (!allowedRoles.includes(userRole)) {
      throw new ApiError(
        `This action requires one of these roles: ${allowedRoles.join(", ")}`,
        403,
        "INSUFFICIENT_ROLE"
      );
    }

    await next();
  };
}

/**
 * Get user's tenants
 *
 * Helper function to get all tenants a user belongs to.
 */
export async function getUserTenants(
  db: D1Database,
  userId: string
): Promise<Array<Tenant & { role: string }>> {
  const result = await db
    .prepare(
      `
      SELECT t.id, t.subdomain, t.company_name, t.is_active, tm.role
      FROM tenants t
      JOIN tenant_members tm ON t.id = tm.tenant_id
      WHERE tm.user_id = ? AND tm.is_active = 1 AND t.is_active = 1
      ORDER BY t.company_name
    `
    )
    .bind(userId)
    .all<Tenant & { role: string }>();

  return result.results || [];
}
