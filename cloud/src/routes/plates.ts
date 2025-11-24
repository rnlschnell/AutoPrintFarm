/**
 * Build Plate Type Routes - Plate Type Management
 *
 * CRUD operations for build plate type presets.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import type { BuildPlateType } from "../types";

export const plates = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createPlateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updatePlateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
});

// =============================================================================
// LIST BUILD PLATE TYPES
// =============================================================================

/**
 * GET /api/v1/plates
 * List all build plate types for the current tenant
 * Supports filtering by is_active
 */
plates.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const isActive = c.req.query("is_active");

  let query = "SELECT * FROM build_plate_types WHERE tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  query += " ORDER BY name ASC";

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<BuildPlateType>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: result.results?.length || 0,
    },
  });
});

// =============================================================================
// GET SINGLE BUILD PLATE TYPE
// =============================================================================

/**
 * GET /api/v1/plates/:id
 * Get a single build plate type by ID
 */
plates.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const plateId = c.req.param("id");

  const plate = await c.env.DB.prepare(
    "SELECT * FROM build_plate_types WHERE id = ? AND tenant_id = ?"
  )
    .bind(plateId, tenantId)
    .first<BuildPlateType>();

  if (!plate) {
    throw new ApiError("Build plate type not found", 404, "PLATE_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: plate,
  });
});

// =============================================================================
// CREATE BUILD PLATE TYPE
// =============================================================================

/**
 * POST /api/v1/plates
 * Create a new build plate type
 */
plates.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createPlateSchema>;
    try {
      const rawBody = await c.req.json();
      body = createPlateSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name
    const existing = await c.env.DB.prepare(
      "SELECT id FROM build_plate_types WHERE tenant_id = ? AND name = ?"
    )
      .bind(tenantId, body.name)
      .first();

    if (existing) {
      throw new ApiError(
        "A build plate type with this name already exists",
        409,
        "DUPLICATE_NAME"
      );
    }

    const plateId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO build_plate_types (
        id, tenant_id, name, description, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(plateId, tenantId, body.name, body.description || null, now, now)
      .run();

    // Fetch the created plate type
    const plate = await c.env.DB.prepare(
      "SELECT * FROM build_plate_types WHERE id = ?"
    )
      .bind(plateId)
      .first<BuildPlateType>();

    return c.json(
      {
        success: true,
        data: plate,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE BUILD PLATE TYPE
// =============================================================================

/**
 * PUT /api/v1/plates/:id
 * Update a build plate type
 */
plates.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const plateId = c.req.param("id");

    // Check plate type exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM build_plate_types WHERE id = ? AND tenant_id = ?"
    )
      .bind(plateId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Build plate type not found", 404, "PLATE_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updatePlateSchema>;
    try {
      const rawBody = await c.req.json();
      body = updatePlateSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name if name is being changed
    if (body.name) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM build_plate_types WHERE tenant_id = ? AND name = ? AND id != ?"
      )
        .bind(tenantId, body.name, plateId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A build plate type with this name already exists",
          409,
          "DUPLICATE_NAME"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(body.name);
    }

    if (body.description !== undefined) {
      updates.push("description = ?");
      values.push(body.description);
    }

    if (body.is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(body.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(plateId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE build_plate_types SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated plate type
    const plate = await c.env.DB.prepare(
      "SELECT * FROM build_plate_types WHERE id = ?"
    )
      .bind(plateId)
      .first<BuildPlateType>();

    return c.json({
      success: true,
      data: plate,
    });
  }
);

// =============================================================================
// DELETE BUILD PLATE TYPE
// =============================================================================

/**
 * DELETE /api/v1/plates/:id
 * Delete a build plate type
 */
plates.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const plateId = c.req.param("id");

    // Check plate type exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM build_plate_types WHERE id = ? AND tenant_id = ?"
    )
      .bind(plateId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Build plate type not found", 404, "PLATE_NOT_FOUND");
    }

    // Delete the plate type
    await c.env.DB.prepare(
      "DELETE FROM build_plate_types WHERE id = ? AND tenant_id = ?"
    )
      .bind(plateId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Build plate type deleted successfully",
    });
  }
);

// =============================================================================
// SEED DEFAULT PLATE TYPES
// =============================================================================

/**
 * POST /api/v1/plates/seed-defaults
 * Create default Bambu Lab plate types for a tenant
 * This is useful for initial setup
 */
plates.post(
  "/seed-defaults",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Default Bambu Lab build plate types
    const defaults = [
      { name: "Cool Plate", description: "Bambu Lab Cool Plate - PLA, PETG" },
      { name: "Engineering Plate", description: "Bambu Lab Engineering Plate - PA, ABS, ASA, PC" },
      { name: "High Temp Plate", description: "Bambu Lab High Temp Plate - PPS, PEEK, high-temp materials" },
      { name: "Textured PEI Plate", description: "Bambu Lab Textured PEI Plate - general purpose" },
    ];

    const now = new Date().toISOString();
    const created: BuildPlateType[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const plateData of defaults) {
      // Check if already exists
      const existing = await c.env.DB.prepare(
        "SELECT id FROM build_plate_types WHERE tenant_id = ? AND name = ?"
      )
        .bind(tenantId, plateData.name)
        .first();

      if (existing) {
        skipped.push({ name: plateData.name, reason: "Already exists" });
        continue;
      }

      const plateId = generateId();

      await c.env.DB.prepare(
        `INSERT INTO build_plate_types (
          id, tenant_id, name, description, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
        .bind(plateId, tenantId, plateData.name, plateData.description, now, now)
        .run();

      const plate = await c.env.DB.prepare(
        "SELECT * FROM build_plate_types WHERE id = ?"
      )
        .bind(plateId)
        .first<BuildPlateType>();

      if (plate) {
        created.push(plate);
      }
    }

    return c.json({
      success: true,
      data: {
        created,
        skipped,
      },
      meta: {
        created_count: created.length,
        skipped_count: skipped.length,
      },
    });
  }
);
