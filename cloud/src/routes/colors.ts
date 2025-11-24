/**
 * Color Preset Routes - Filament Color Management
 *
 * CRUD operations for color presets used in product SKUs.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import type { ColorPreset } from "../types";

export const colors = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createColorSchema = z.object({
  color_name: z.string().min(1).max(100),
  hex_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color code (must be #RRGGBB format)"),
  filament_type: z.string().min(1).max(50), // PLA, PETG, ABS, etc.
});

const updateColorSchema = z.object({
  color_name: z.string().min(1).max(100).optional(),
  hex_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color code (must be #RRGGBB format)")
    .optional(),
  filament_type: z.string().min(1).max(50).optional(),
  is_active: z.boolean().optional(),
});

// =============================================================================
// LIST COLOR PRESETS
// =============================================================================

/**
 * GET /api/v1/colors
 * List all color presets for the current tenant
 * Supports filtering by filament_type, is_active
 */
colors.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const filamentType = c.req.query("filament_type");
  const isActive = c.req.query("is_active");

  let query = "SELECT * FROM color_presets WHERE tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (filamentType) {
    query += " AND filament_type = ?";
    params.push(filamentType);
  }

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  query += " ORDER BY color_name ASC";

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<ColorPreset>();

  const items = result.results || [];

  return c.json({
    success: true,
    data: {
      items,
      total: items.length,
      page: 1,
      limit: items.length,
      hasMore: false,
    },
  });
});

// =============================================================================
// GET SINGLE COLOR PRESET
// =============================================================================

/**
 * GET /api/v1/colors/:id
 * Get a single color preset by ID
 */
colors.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const colorId = c.req.param("id");

  const color = await c.env.DB.prepare(
    "SELECT * FROM color_presets WHERE id = ? AND tenant_id = ?"
  )
    .bind(colorId, tenantId)
    .first<ColorPreset>();

  if (!color) {
    throw new ApiError("Color preset not found", 404, "COLOR_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: color,
  });
});

// =============================================================================
// CREATE COLOR PRESET
// =============================================================================

/**
 * POST /api/v1/colors
 * Create a new color preset
 */
colors.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createColorSchema>;
    try {
      const rawBody = await c.req.json();
      body = createColorSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate (same name + filament type)
    const existing = await c.env.DB.prepare(
      "SELECT id FROM color_presets WHERE tenant_id = ? AND color_name = ? AND filament_type = ?"
    )
      .bind(tenantId, body.color_name, body.filament_type)
      .first();

    if (existing) {
      throw new ApiError(
        "A color preset with this name and filament type already exists",
        409,
        "DUPLICATE_COLOR"
      );
    }

    const colorId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO color_presets (
        id, tenant_id, color_name, hex_code, filament_type, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        colorId,
        tenantId,
        body.color_name,
        body.hex_code.toUpperCase(),
        body.filament_type,
        now
      )
      .run();

    // Fetch the created color preset
    const color = await c.env.DB.prepare(
      "SELECT * FROM color_presets WHERE id = ? AND tenant_id = ?"
    )
      .bind(colorId, tenantId)
      .first<ColorPreset>();

    return c.json(
      {
        success: true,
        data: color,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE COLOR PRESET
// =============================================================================

/**
 * PUT /api/v1/colors/:id
 * Update a color preset
 */
colors.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const colorId = c.req.param("id");

    // Check color preset exists
    const existing = await c.env.DB.prepare(
      "SELECT id, color_name, filament_type FROM color_presets WHERE id = ? AND tenant_id = ?"
    )
      .bind(colorId, tenantId)
      .first<{ id: string; color_name: string; filament_type: string }>();

    if (!existing) {
      throw new ApiError("Color preset not found", 404, "COLOR_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateColorSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateColorSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate if name or filament_type is changing
    const newName = body.color_name ?? existing.color_name;
    const newFilamentType = body.filament_type ?? existing.filament_type;

    if (body.color_name || body.filament_type) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM color_presets WHERE tenant_id = ? AND color_name = ? AND filament_type = ? AND id != ?"
      )
        .bind(tenantId, newName, newFilamentType, colorId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A color preset with this name and filament type already exists",
          409,
          "DUPLICATE_COLOR"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.color_name !== undefined) {
      updates.push("color_name = ?");
      values.push(body.color_name);
    }

    if (body.hex_code !== undefined) {
      updates.push("hex_code = ?");
      values.push(body.hex_code.toUpperCase());
    }

    if (body.filament_type !== undefined) {
      updates.push("filament_type = ?");
      values.push(body.filament_type);
    }

    if (body.is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(body.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    values.push(colorId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE color_presets SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated color preset
    const color = await c.env.DB.prepare(
      "SELECT * FROM color_presets WHERE id = ? AND tenant_id = ?"
    )
      .bind(colorId, tenantId)
      .first<ColorPreset>();

    return c.json({
      success: true,
      data: color,
    });
  }
);

// =============================================================================
// DELETE COLOR PRESET
// =============================================================================

/**
 * DELETE /api/v1/colors/:id
 * Delete a color preset
 */
colors.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const colorId = c.req.param("id");

    // Check color preset exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM color_presets WHERE id = ? AND tenant_id = ?"
    )
      .bind(colorId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Color preset not found", 404, "COLOR_NOT_FOUND");
    }

    // Delete the color preset
    await c.env.DB.prepare(
      "DELETE FROM color_presets WHERE id = ? AND tenant_id = ?"
    )
      .bind(colorId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Color preset deleted successfully",
    });
  }
);

// =============================================================================
// GET FILAMENT TYPES
// =============================================================================

/**
 * GET /api/v1/colors/filament-types
 * Get list of unique filament types for the tenant
 */
colors.get("/filament-types", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT DISTINCT filament_type FROM color_presets
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY filament_type ASC`
  )
    .bind(tenantId)
    .all<{ filament_type: string }>();

  const filamentTypes = (result.results || []).map((r) => r.filament_type);

  return c.json({
    success: true,
    data: filamentTypes,
  });
});

// =============================================================================
// BATCH CREATE COLOR PRESETS
// =============================================================================

/**
 * POST /api/v1/colors/batch
 * Create multiple color presets at once
 */
colors.post(
  "/batch",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse request body
    let body: { colors: z.infer<typeof createColorSchema>[] };
    try {
      const rawBody = await c.req.json();
      body = z.object({
        colors: z.array(createColorSchema).min(1).max(100),
      }).parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();
    const created: ColorPreset[] = [];
    const skipped: Array<{ color_name: string; filament_type: string; reason: string }> = [];

    // Process each color
    for (const colorData of body.colors) {
      // Check for duplicate
      const existing = await c.env.DB.prepare(
        "SELECT id FROM color_presets WHERE tenant_id = ? AND color_name = ? AND filament_type = ?"
      )
        .bind(tenantId, colorData.color_name, colorData.filament_type)
        .first();

      if (existing) {
        skipped.push({
          color_name: colorData.color_name,
          filament_type: colorData.filament_type,
          reason: "Already exists",
        });
        continue;
      }

      const colorId = generateId();

      await c.env.DB.prepare(
        `INSERT INTO color_presets (
          id, tenant_id, color_name, hex_code, filament_type, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
        .bind(
          colorId,
          tenantId,
          colorData.color_name,
          colorData.hex_code.toUpperCase(),
          colorData.filament_type,
          now
        )
        .run();

      const color = await c.env.DB.prepare(
        "SELECT * FROM color_presets WHERE id = ? AND tenant_id = ?"
      )
        .bind(colorId, tenantId)
        .first<ColorPreset>();

      if (color) {
        created.push(color);
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
