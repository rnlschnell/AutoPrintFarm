/**
 * Tenant Routes - Multi-tenancy Management
 *
 * Endpoints for creating, managing, and switching between tenants.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles, getUserTenants } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import {
  memberInviteRateLimit,
  roleChangeRateLimit,
  memberRemovalRateLimit,
} from "../middleware/rate-limit";

export const tenants = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createTenantSchema = z.object({
  subdomain: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Subdomain must be lowercase alphanumeric with hyphens"),
  company_name: z.string().min(1).max(100),
});

const updateTenantSchema = z.object({
  company_name: z.string().min(1).max(100).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer"]),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

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

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/v1/tenants/ensure
 * Ensure user has at least one tenant. If they don't, create a default one.
 * This endpoint handles edge cases where signup didn't create a tenant.
 */
tenants.post("/ensure", requireAuth(), async (c) => {
  const userId = c.get("userId")!;

  // Check if user already has any tenants
  const existingTenants = await getUserTenants(c.env.DB, userId);

  if (existingTenants.length > 0) {
    // User already has tenants, return the first one
    return c.json({
      success: true,
      data: existingTenants[0],
      created: false,
    });
  }

  // Get user info for generating tenant name
  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{ id: string; email: string; full_name: string }>();

  if (!user) {
    throw new ApiError("User not found", 404, "USER_NOT_FOUND");
  }

  // Generate subdomain from email
  const emailLocal = user.email.split("@")[0] || "user";
  let subdomain = emailLocal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 24);

  if (subdomain.length < 3) {
    subdomain = subdomain + "-" + generateId().substring(0, 6);
  }

  // Add random suffix to ensure uniqueness
  subdomain = subdomain + "-" + generateId().substring(0, 4);
  subdomain = subdomain.substring(0, 32);

  // Check if subdomain is taken (very unlikely with random suffix, but be safe)
  const existingSubdomain = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE subdomain = ?"
  )
    .bind(subdomain)
    .first();

  if (existingSubdomain) {
    // Add more random chars
    subdomain = subdomain.substring(0, 26) + "-" + generateId().substring(0, 5);
  }

  const tenantId = generateId();
  const memberId = generateId();
  const now = new Date().toISOString();
  const companyName = user.full_name
    ? `${user.full_name}'s Organization`
    : "My Organization";

  // Create tenant and membership in a batch
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tenants (id, subdomain, company_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).bind(tenantId, subdomain, companyName, now, now),
    c.env.DB.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 1, ?, ?, ?)`
    ).bind(memberId, tenantId, userId, now, now, now),
  ]);

  return c.json(
    {
      success: true,
      data: {
        id: tenantId,
        subdomain: subdomain,
        company_name: companyName,
        role: "owner",
      },
      created: true,
    },
    201
  );
});

/**
 * GET /api/v1/tenants
 * List all tenants the current user belongs to
 */
tenants.get("/", requireAuth(), async (c) => {
  const userId = c.get("userId")!;
  const userTenants = await getUserTenants(c.env.DB, userId);

  return c.json({
    success: true,
    data: userTenants,
  });
});

/**
 * POST /api/v1/tenants
 * Create a new tenant (user becomes owner)
 */
tenants.post("/", requireAuth(), async (c) => {
  const userId = c.get("userId")!;

  // Parse and validate request body
  let body: z.infer<typeof createTenantSchema>;
  try {
    const rawBody = await c.req.json();
    body = createTenantSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error; // Let the global error handler format ZodError
    }
    throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
  }

  // Check if subdomain is already taken
  const existing = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE subdomain = ?"
  )
    .bind(body.subdomain)
    .first();

  if (existing) {
    throw new ApiError(
      "Subdomain is already taken",
      409,
      "SUBDOMAIN_TAKEN"
    );
  }

  const tenantId = generateId();
  const memberId = generateId();
  const now = new Date().toISOString();

  // Create tenant and membership in a batch
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tenants (id, subdomain, company_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).bind(tenantId, body.subdomain, body.company_name, now, now),
    c.env.DB.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 1, ?, ?, ?)`
    ).bind(memberId, tenantId, userId, now, now, now),
  ]);

  return c.json(
    {
      success: true,
      data: {
        id: tenantId,
        subdomain: body.subdomain,
        company_name: body.company_name,
        role: "owner",
      },
    },
    201
  );
});

/**
 * GET /api/v1/tenants/:id
 * Get tenant details (requires membership)
 */
tenants.get("/:id", requireAuth(), async (c) => {
  const userId = c.get("userId")!;
  const tenantId = c.req.param("id");

  // Check membership and get tenant details
  const result = await c.env.DB.prepare(
    `SELECT t.id, t.subdomain, t.company_name, t.is_active, t.created_at, tm.role
     FROM tenants t
     JOIN tenant_members tm ON t.id = tm.tenant_id
     WHERE t.id = ? AND tm.user_id = ? AND tm.is_active = 1`
  )
    .bind(tenantId, userId)
    .first();

  if (!result) {
    throw new ApiError("Tenant not found or access denied", 404, "NOT_FOUND");
  }

  // Get member count
  const memberCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM tenant_members WHERE tenant_id = ? AND is_active = 1"
  )
    .bind(tenantId)
    .first<{ count: number }>();

  return c.json({
    success: true,
    data: {
      ...result,
      member_count: memberCount?.count || 0,
    },
  });
});

/**
 * PUT /api/v1/tenants/:id
 * Update tenant details (owner/admin only)
 */
tenants.put("/:id", requireAuth(), requireTenant(), requireRoles(["owner", "admin"]), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Parse and validate request body
  let body: z.infer<typeof updateTenantSchema>;
  try {
    const rawBody = await c.req.json();
    body = updateTenantSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error; // Let the global error handler format ZodError
    }
    throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
  }

  if (!body.company_name) {
    throw new ApiError("No updates provided", 400, "NO_UPDATES");
  }

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    "UPDATE tenants SET company_name = ?, updated_at = ? WHERE id = ?"
  )
    .bind(body.company_name, now, tenantId)
    .run();

  return c.json({
    success: true,
    message: "Tenant updated successfully",
  });
});

/**
 * GET /api/v1/tenants/:id/members
 * List tenant members (requires membership)
 */
tenants.get("/:id/members", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT tm.id, tm.user_id, tm.role, tm.is_active, tm.accepted_at, tm.created_at,
            u.email, u.full_name
     FROM tenant_members tm
     JOIN users u ON tm.user_id = u.id
     WHERE tm.tenant_id = ?
     ORDER BY tm.role, u.full_name`
  )
    .bind(tenantId)
    .all();

  return c.json({
    success: true,
    data: result.results || [],
  });
});

/**
 * POST /api/v1/tenants/:id/members
 * Invite a new member (owner/admin only)
 * Rate limited: 20 invitations per tenant per hour
 */
tenants.post(
  "/:id/members",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  memberInviteRateLimit,
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const invitedBy = c.get("userId")!;

    // Parse and validate request body
    let body: z.infer<typeof inviteMemberSchema>;
    try {
      const rawBody = await c.req.json();
      body = inviteMemberSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error; // Let the global error handler format ZodError
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Find user by email
    const user = await c.env.DB.prepare(
      "SELECT id, email, full_name FROM users WHERE email = ?"
    )
      .bind(body.email)
      .first<{ id: string; email: string; full_name: string }>();

    if (!user) {
      throw new ApiError(
        "User not found. They must register first.",
        404,
        "USER_NOT_FOUND"
      );
    }

    // Check if already a member
    const existingMember = await c.env.DB.prepare(
      "SELECT id, is_active FROM tenant_members WHERE tenant_id = ? AND user_id = ?"
    )
      .bind(tenantId, user.id)
      .first<{ id: string; is_active: number }>();

    if (existingMember) {
      if (existingMember.is_active) {
        throw new ApiError(
          "User is already a member of this tenant",
          409,
          "ALREADY_MEMBER"
        );
      }

      // Reactivate membership
      const now = new Date().toISOString();
      await c.env.DB.prepare(
        `UPDATE tenant_members
         SET role = ?, is_active = 1, invited_by = ?, invited_at = ?, accepted_at = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(body.role, invitedBy, now, now, now, existingMember.id)
        .run();

      return c.json({
        success: true,
        message: "Member reactivated",
        data: {
          user_id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: body.role,
        },
      });
    }

    // Create new membership
    const memberId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, role, invited_by, invited_at, accepted_at, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(memberId, tenantId, user.id, body.role, invitedBy, now, now, now, now)
      .run();

    return c.json(
      {
        success: true,
        message: "Member added successfully",
        data: {
          user_id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: body.role,
        },
      },
      201
    );
  }
);

/**
 * PUT /api/v1/tenants/:id/members/:userId
 * Update member role (owner only, can't change owner role)
 * Rate limited: 30 role changes per tenant per hour
 */
tenants.put(
  "/:id/members/:userId",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner"]),
  roleChangeRateLimit,
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const targetUserId = c.req.param("userId");

    const body = await c.req.json<{ role: string }>();

    if (!["admin", "operator", "viewer"].includes(body.role)) {
      throw new ApiError("Invalid role", 400, "INVALID_ROLE");
    }

    // Check target membership exists and is not an owner
    const membership = await c.env.DB.prepare(
      "SELECT id, role FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND is_active = 1"
    )
      .bind(tenantId, targetUserId)
      .first<{ id: string; role: string }>();

    if (!membership) {
      throw new ApiError("Member not found", 404, "MEMBER_NOT_FOUND");
    }

    if (membership.role === "owner") {
      throw new ApiError("Cannot change owner's role", 403, "CANNOT_MODIFY_OWNER");
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "UPDATE tenant_members SET role = ?, updated_at = ? WHERE id = ?"
    )
      .bind(body.role, now, membership.id)
      .run();

    return c.json({
      success: true,
      message: "Member role updated",
    });
  }
);

/**
 * DELETE /api/v1/tenants/:id/members/:userId
 * Remove a member (owner/admin only, can't remove owner)
 * Rate limited: 20 removals per tenant per hour
 */
tenants.delete(
  "/:id/members/:userId",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  memberRemovalRateLimit,
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const targetUserId = c.req.param("userId");

    // Check target membership exists
    const membership = await c.env.DB.prepare(
      "SELECT id, role FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND is_active = 1"
    )
      .bind(tenantId, targetUserId)
      .first<{ id: string; role: string }>();

    if (!membership) {
      throw new ApiError("Member not found", 404, "MEMBER_NOT_FOUND");
    }

    if (membership.role === "owner") {
      throw new ApiError("Cannot remove owner from tenant", 403, "CANNOT_REMOVE_OWNER");
    }

    // Admins can only remove operators and viewers
    const currentUserRole = c.get("userRole");
    if (currentUserRole === "admin" && membership.role === "admin") {
      throw new ApiError("Admins cannot remove other admins", 403, "INSUFFICIENT_PERMISSION");
    }

    const now = new Date().toISOString();

    // Soft delete - deactivate membership
    await c.env.DB.prepare(
      "UPDATE tenant_members SET is_active = 0, updated_at = ? WHERE id = ?"
    )
      .bind(now, membership.id)
      .run();

    return c.json({
      success: true,
      message: "Member removed successfully",
    });
  }
);
