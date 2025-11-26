/**
 * Material Inventory Routes
 *
 * CRUD operations for material inventory tracking:
 * - Filament inventory
 * - Packaging inventory
 * - Components/accessories inventory
 * - Printer parts inventory
 *
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";

export const materials = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const filamentSchema = z.object({
  type: z.string().min(1).max(100),
  color: z.string().min(1).max(50),  // Required for filament
  hex_code: z.string().max(7).optional(),
  brand: z.string().max(100).optional(),
  diameter: z.string().max(20).optional(),
  remaining_grams: z.number().min(0).default(0),
  spool_weight_grams: z.number().min(0).optional(),
  location: z.string().max(200).optional(),
  cost_per_unit: z.number().min(0).optional(),
  low_threshold: z.number().min(0).optional(),
  reorder_link: z.string().max(500).optional(),
  status: z.enum(["in_stock", "low", "out_of_stock", "on_order"]).optional(),
});

const packagingSchema = z.object({
  type: z.string().min(1).max(100),
  brand: z.string().max(100).optional(),
  remaining_units: z.number().int().min(0).default(0),
  location: z.string().max(200).optional(),
  cost_per_unit: z.number().min(0).optional(),
  low_threshold: z.number().int().min(0).optional(),
  reorder_link: z.string().url().max(500).optional(),
  status: z.enum(["in_stock", "low", "out_of_stock"]).optional(),
});

const componentsSchema = z.object({
  type: z.string().min(1).max(100),
  brand: z.string().max(100).optional(),
  remaining_units: z.number().int().min(0).default(0),
  location: z.string().max(200).optional(),
  cost_per_unit: z.number().min(0).optional(),
  low_threshold: z.number().int().min(0).optional(),
  reorder_link: z.string().url().max(500).optional(),
  status: z.enum(["in_stock", "low", "out_of_stock"]).optional(),
});

const partsSchema = z.object({
  type: z.string().min(1).max(100),
  brand: z.string().max(100).optional(),
  remaining_units: z.number().int().min(0).default(0),
  location: z.string().max(200).optional(),
  cost_per_unit: z.number().min(0).optional(),
  low_threshold: z.number().int().min(0).optional(),
  reorder_link: z.string().url().max(500).optional(),
  status: z.enum(["in_stock", "low", "out_of_stock"]).optional(),
});

// Helper to calculate status
function calculateStatus(
  remaining: number,
  lowThreshold: number | null | undefined
): string {
  if (remaining === 0) return "out_of_stock";
  if (lowThreshold && remaining <= lowThreshold) return "low";
  return "in_stock";
}

// =============================================================================
// FILAMENT INVENTORY
// =============================================================================

/**
 * GET /api/v1/materials/filament
 * List all filament inventory
 */
materials.get("/filament", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT * FROM filament_inventory
     WHERE tenant_id = ?
     ORDER BY created_at DESC`
  )
    .bind(tenantId)
    .all();

  return c.json({
    success: true,
    data: result.results || [],
  });
});

/**
 * GET /api/v1/materials/filament/:id
 * Get single filament item
 */
materials.get("/filament/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT * FROM filament_inventory WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, tenantId)
    .first();

  if (!result) {
    throw new ApiError("Filament not found", 404, "NOT_FOUND");
  }

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/materials/filament
 * Create filament inventory item
 */
materials.post(
  "/filament",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof filamentSchema>;
    try {
      const rawBody = await c.req.json();
      body = filamentSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new ApiError(`Validation error: ${issues}`, 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const id = generateId();
    const now = new Date().toISOString();
    const status = body.status || calculateStatus(body.remaining_grams, body.low_threshold);

    await c.env.DB.prepare(
      `INSERT INTO filament_inventory
       (id, tenant_id, type, color, hex_code, brand, diameter, remaining_grams, spool_weight_grams, location, cost_per_unit, low_threshold, reorder_link, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        tenantId,
        body.type,
        body.color,
        body.hex_code || null,
        body.brand || null,
        body.diameter || '1.75mm',
        body.remaining_grams,
        body.spool_weight_grams || 1000,
        body.location || null,
        body.cost_per_unit || null,
        body.low_threshold || 100,
        body.reorder_link || null,
        status,
        now,
        now
      )
      .run();

    const created = await c.env.DB.prepare(
      `SELECT * FROM filament_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: created }, 201);
  }
);

/**
 * PATCH /api/v1/materials/filament/:id
 * Update filament inventory item
 */
materials.patch(
  "/filament/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT * FROM filament_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Filament not found", 404, "NOT_FOUND");
    }

    let body: Partial<z.infer<typeof filamentSchema>>;
    try {
      const rawBody = await c.req.json();
      body = filamentSchema.partial().parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.type !== undefined) {
      updates.push("type = ?");
      values.push(body.type);
    }
    if (body.color !== undefined) {
      updates.push("color = ?");
      values.push(body.color);
    }
    if (body.hex_code !== undefined) {
      updates.push("hex_code = ?");
      values.push(body.hex_code);
    }
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand);
    }
    if (body.diameter !== undefined) {
      updates.push("diameter = ?");
      values.push(body.diameter);
    }
    if (body.remaining_grams !== undefined) {
      updates.push("remaining_grams = ?");
      values.push(body.remaining_grams);
    }
    if (body.spool_weight_grams !== undefined) {
      updates.push("spool_weight_grams = ?");
      values.push(body.spool_weight_grams);
    }
    if (body.location !== undefined) {
      updates.push("location = ?");
      values.push(body.location);
    }
    if (body.cost_per_unit !== undefined) {
      updates.push("cost_per_unit = ?");
      values.push(body.cost_per_unit);
    }
    if (body.low_threshold !== undefined) {
      updates.push("low_threshold = ?");
      values.push(body.low_threshold);
    }
    if (body.reorder_link !== undefined) {
      updates.push("reorder_link = ?");
      values.push(body.reorder_link);
    }

    // Recalculate status
    const newRemaining = body.remaining_grams ?? (existing as any).remaining_grams;
    const newThreshold = body.low_threshold ?? (existing as any).low_threshold;
    const status = body.status || calculateStatus(newRemaining, newThreshold);
    updates.push("status = ?");
    values.push(status);

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id, tenantId);

    await c.env.DB.prepare(
      `UPDATE filament_inventory SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    const updated = await c.env.DB.prepare(
      `SELECT * FROM filament_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /api/v1/materials/filament/:id
 * Delete filament inventory item
 */
materials.delete(
  "/filament/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT id FROM filament_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Filament not found", 404, "NOT_FOUND");
    }

    await c.env.DB.prepare(
      `DELETE FROM filament_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .run();

    return c.json({ success: true, message: "Filament deleted successfully" });
  }
);

// =============================================================================
// PACKAGING INVENTORY
// =============================================================================

/**
 * GET /api/v1/materials/packaging
 * List all packaging inventory
 */
materials.get("/packaging", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT * FROM packaging_inventory
     WHERE tenant_id = ?
     ORDER BY created_at DESC`
  )
    .bind(tenantId)
    .all();

  return c.json({
    success: true,
    data: result.results || [],
  });
});

/**
 * GET /api/v1/materials/packaging/:id
 * Get single packaging item
 */
materials.get("/packaging/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT * FROM packaging_inventory WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, tenantId)
    .first();

  if (!result) {
    throw new ApiError("Packaging not found", 404, "NOT_FOUND");
  }

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/materials/packaging
 * Create packaging inventory item
 */
materials.post(
  "/packaging",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof packagingSchema>;
    try {
      const rawBody = await c.req.json();
      body = packagingSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const id = generateId();
    const now = new Date().toISOString();
    const status = body.status || calculateStatus(body.remaining_units, body.low_threshold);

    await c.env.DB.prepare(
      `INSERT INTO packaging_inventory
       (id, tenant_id, type, brand, remaining_units, location, cost_per_unit, low_threshold, reorder_link, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        tenantId,
        body.type,
        body.brand || null,
        body.remaining_units,
        body.location || null,
        body.cost_per_unit || null,
        body.low_threshold || null,
        body.reorder_link || null,
        status,
        now,
        now
      )
      .run();

    const created = await c.env.DB.prepare(
      `SELECT * FROM packaging_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: created }, 201);
  }
);

/**
 * PATCH /api/v1/materials/packaging/:id
 * Update packaging inventory item
 */
materials.patch(
  "/packaging/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT * FROM packaging_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Packaging not found", 404, "NOT_FOUND");
    }

    let body: Partial<z.infer<typeof packagingSchema>>;
    try {
      const rawBody = await c.req.json();
      body = packagingSchema.partial().parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.type !== undefined) {
      updates.push("type = ?");
      values.push(body.type);
    }
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand);
    }
    if (body.remaining_units !== undefined) {
      updates.push("remaining_units = ?");
      values.push(body.remaining_units);
    }
    if (body.location !== undefined) {
      updates.push("location = ?");
      values.push(body.location);
    }
    if (body.cost_per_unit !== undefined) {
      updates.push("cost_per_unit = ?");
      values.push(body.cost_per_unit);
    }
    if (body.low_threshold !== undefined) {
      updates.push("low_threshold = ?");
      values.push(body.low_threshold);
    }
    if (body.reorder_link !== undefined) {
      updates.push("reorder_link = ?");
      values.push(body.reorder_link);
    }

    const newRemaining = body.remaining_units ?? (existing as any).remaining_units;
    const newThreshold = body.low_threshold ?? (existing as any).low_threshold;
    const status = body.status || calculateStatus(newRemaining, newThreshold);
    updates.push("status = ?");
    values.push(status);

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id, tenantId);

    await c.env.DB.prepare(
      `UPDATE packaging_inventory SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    const updated = await c.env.DB.prepare(
      `SELECT * FROM packaging_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /api/v1/materials/packaging/:id
 * Delete packaging inventory item
 */
materials.delete(
  "/packaging/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT id FROM packaging_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Packaging not found", 404, "NOT_FOUND");
    }

    await c.env.DB.prepare(
      `DELETE FROM packaging_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .run();

    return c.json({ success: true, message: "Packaging deleted successfully" });
  }
);

// =============================================================================
// COMPONENTS/ACCESSORIES INVENTORY
// =============================================================================

/**
 * GET /api/v1/materials/components
 * List all components inventory
 */
materials.get("/components", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT * FROM accessories_inventory
     WHERE tenant_id = ?
     ORDER BY created_at DESC`
  )
    .bind(tenantId)
    .all();

  return c.json({
    success: true,
    data: result.results || [],
  });
});

/**
 * GET /api/v1/materials/components/:id
 * Get single component item
 */
materials.get("/components/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT * FROM accessories_inventory WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, tenantId)
    .first();

  if (!result) {
    throw new ApiError("Component not found", 404, "NOT_FOUND");
  }

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/materials/components
 * Create component inventory item
 */
materials.post(
  "/components",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof componentsSchema>;
    try {
      const rawBody = await c.req.json();
      body = componentsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const id = generateId();
    const now = new Date().toISOString();
    const status = body.status || calculateStatus(body.remaining_units, body.low_threshold);

    await c.env.DB.prepare(
      `INSERT INTO accessories_inventory
       (id, tenant_id, type, brand, remaining_units, location, cost_per_unit, low_threshold, reorder_link, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        tenantId,
        body.type,
        body.brand || null,
        body.remaining_units,
        body.location || null,
        body.cost_per_unit || null,
        body.low_threshold || null,
        body.reorder_link || null,
        status,
        now,
        now
      )
      .run();

    const created = await c.env.DB.prepare(
      `SELECT * FROM accessories_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: created }, 201);
  }
);

/**
 * PATCH /api/v1/materials/components/:id
 * Update component inventory item
 */
materials.patch(
  "/components/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT * FROM accessories_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Component not found", 404, "NOT_FOUND");
    }

    let body: Partial<z.infer<typeof componentsSchema>>;
    try {
      const rawBody = await c.req.json();
      body = componentsSchema.partial().parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.type !== undefined) {
      updates.push("type = ?");
      values.push(body.type);
    }
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand);
    }
    if (body.remaining_units !== undefined) {
      updates.push("remaining_units = ?");
      values.push(body.remaining_units);
    }
    if (body.location !== undefined) {
      updates.push("location = ?");
      values.push(body.location);
    }
    if (body.cost_per_unit !== undefined) {
      updates.push("cost_per_unit = ?");
      values.push(body.cost_per_unit);
    }
    if (body.low_threshold !== undefined) {
      updates.push("low_threshold = ?");
      values.push(body.low_threshold);
    }
    if (body.reorder_link !== undefined) {
      updates.push("reorder_link = ?");
      values.push(body.reorder_link);
    }

    const newRemaining = body.remaining_units ?? (existing as any).remaining_units;
    const newThreshold = body.low_threshold ?? (existing as any).low_threshold;
    const status = body.status || calculateStatus(newRemaining, newThreshold);
    updates.push("status = ?");
    values.push(status);

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id, tenantId);

    await c.env.DB.prepare(
      `UPDATE accessories_inventory SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    const updated = await c.env.DB.prepare(
      `SELECT * FROM accessories_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /api/v1/materials/components/:id
 * Delete component inventory item
 */
materials.delete(
  "/components/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT id FROM accessories_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Component not found", 404, "NOT_FOUND");
    }

    await c.env.DB.prepare(
      `DELETE FROM accessories_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .run();

    return c.json({ success: true, message: "Component deleted successfully" });
  }
);

// Schema for consuming components
const consumeComponentSchema = z.object({
  quantity: z.number().int().min(1),
  reason: z.enum(["assembly_completion", "manual_adjustment", "damaged", "other"]).optional().default("manual_adjustment"),
  assembly_task_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/v1/materials/components/:id/consume
 * Consume component inventory (decrement quantity)
 * Used during assembly completion to track component usage
 */
materials.post(
  "/components/:id/consume",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    // Get existing component
    const existing = await c.env.DB.prepare(
      `SELECT * FROM accessories_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first<{
        id: string;
        type: string;
        remaining_units: number;
        low_threshold: number | null;
      }>();

    if (!existing) {
      throw new ApiError("Component not found", 404, "NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof consumeComponentSchema>;
    try {
      const rawBody = await c.req.json();
      body = consumeComponentSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new ApiError(`Validation error: ${issues}`, 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check if there's sufficient quantity
    if (existing.remaining_units < body.quantity) {
      throw new ApiError(
        `Insufficient quantity: requested ${body.quantity}, available ${existing.remaining_units}`,
        400,
        "INSUFFICIENT_QUANTITY"
      );
    }

    // Calculate new quantity and status
    const newRemaining = existing.remaining_units - body.quantity;
    const newStatus = calculateStatus(newRemaining, existing.low_threshold);
    const now = new Date().toISOString();

    // Update the component
    await c.env.DB.prepare(
      `UPDATE accessories_inventory
       SET remaining_units = ?, status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(newRemaining, newStatus, now, id, tenantId)
      .run();

    // Get updated record
    const updated = await c.env.DB.prepare(
      `SELECT * FROM accessories_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({
      success: true,
      data: updated,
      consumed: {
        quantity: body.quantity,
        reason: body.reason,
        assembly_task_id: body.assembly_task_id,
        notes: body.notes,
        previous_quantity: existing.remaining_units,
        new_quantity: newRemaining,
      },
    });
  }
);

/**
 * POST /api/v1/materials/components/check-availability
 * Check if components are available for assembly
 * Returns availability status for multiple components at once
 */
materials.post(
  "/components/check-availability",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse request body - expects array of { component_type, quantity_needed }
    let body: { components: Array<{ component_type: string; quantity_needed: number }> };
    try {
      body = await c.req.json();
      if (!body.components || !Array.isArray(body.components)) {
        throw new Error("components array required");
      }
    } catch {
      throw new ApiError("Invalid request body: expected { components: [{ component_type, quantity_needed }] }", 400, "INVALID_REQUEST");
    }

    const results: Array<{
      component_type: string;
      quantity_needed: number;
      quantity_available: number;
      has_shortage: boolean;
      shortage_amount: number;
      component_id: string | null;
    }> = [];

    for (const component of body.components) {
      // Find component by type
      const existing = await c.env.DB.prepare(
        `SELECT id, type, remaining_units FROM accessories_inventory
         WHERE tenant_id = ? AND LOWER(type) = LOWER(?)
         LIMIT 1`
      )
        .bind(tenantId, component.component_type)
        .first<{ id: string; type: string; remaining_units: number }>();

      const available = existing?.remaining_units || 0;
      const shortage = Math.max(0, component.quantity_needed - available);

      results.push({
        component_type: component.component_type,
        quantity_needed: component.quantity_needed,
        quantity_available: available,
        has_shortage: shortage > 0,
        shortage_amount: shortage,
        component_id: existing?.id || null,
      });
    }

    const hasAnyShortage = results.some(r => r.has_shortage);

    return c.json({
      success: true,
      has_shortage: hasAnyShortage,
      components: results,
    });
  }
);

// =============================================================================
// PRINTER PARTS INVENTORY
// =============================================================================

/**
 * GET /api/v1/materials/parts
 * List all printer parts inventory
 */
materials.get("/parts", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT * FROM printer_parts_inventory
     WHERE tenant_id = ?
     ORDER BY created_at DESC`
  )
    .bind(tenantId)
    .all();

  return c.json({
    success: true,
    data: result.results || [],
  });
});

/**
 * GET /api/v1/materials/parts/:id
 * Get single printer part item
 */
materials.get("/parts/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT * FROM printer_parts_inventory WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, tenantId)
    .first();

  if (!result) {
    throw new ApiError("Printer part not found", 404, "NOT_FOUND");
  }

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/materials/parts
 * Create printer part inventory item
 */
materials.post(
  "/parts",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof partsSchema>;
    try {
      const rawBody = await c.req.json();
      body = partsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const id = generateId();
    const now = new Date().toISOString();
    const status = body.status || calculateStatus(body.remaining_units, body.low_threshold);

    await c.env.DB.prepare(
      `INSERT INTO printer_parts_inventory
       (id, tenant_id, type, brand, remaining_units, location, cost_per_unit, low_threshold, reorder_link, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        tenantId,
        body.type,
        body.brand || null,
        body.remaining_units,
        body.location || null,
        body.cost_per_unit || null,
        body.low_threshold || null,
        body.reorder_link || null,
        status,
        now,
        now
      )
      .run();

    const created = await c.env.DB.prepare(
      `SELECT * FROM printer_parts_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: created }, 201);
  }
);

/**
 * PATCH /api/v1/materials/parts/:id
 * Update printer part inventory item
 */
materials.patch(
  "/parts/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT * FROM printer_parts_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer part not found", 404, "NOT_FOUND");
    }

    let body: Partial<z.infer<typeof partsSchema>>;
    try {
      const rawBody = await c.req.json();
      body = partsSchema.partial().parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError("Validation error", 400, "VALIDATION_ERROR");
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.type !== undefined) {
      updates.push("type = ?");
      values.push(body.type);
    }
    if (body.brand !== undefined) {
      updates.push("brand = ?");
      values.push(body.brand);
    }
    if (body.remaining_units !== undefined) {
      updates.push("remaining_units = ?");
      values.push(body.remaining_units);
    }
    if (body.location !== undefined) {
      updates.push("location = ?");
      values.push(body.location);
    }
    if (body.cost_per_unit !== undefined) {
      updates.push("cost_per_unit = ?");
      values.push(body.cost_per_unit);
    }
    if (body.low_threshold !== undefined) {
      updates.push("low_threshold = ?");
      values.push(body.low_threshold);
    }
    if (body.reorder_link !== undefined) {
      updates.push("reorder_link = ?");
      values.push(body.reorder_link);
    }

    const newRemaining = body.remaining_units ?? (existing as any).remaining_units;
    const newThreshold = body.low_threshold ?? (existing as any).low_threshold;
    const status = body.status || calculateStatus(newRemaining, newThreshold);
    updates.push("status = ?");
    values.push(status);

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id, tenantId);

    await c.env.DB.prepare(
      `UPDATE printer_parts_inventory SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    const updated = await c.env.DB.prepare(
      `SELECT * FROM printer_parts_inventory WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /api/v1/materials/parts/:id
 * Delete printer part inventory item
 */
materials.delete(
  "/parts/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare(
      `SELECT id FROM printer_parts_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer part not found", 404, "NOT_FOUND");
    }

    await c.env.DB.prepare(
      `DELETE FROM printer_parts_inventory WHERE id = ? AND tenant_id = ?`
    )
      .bind(id, tenantId)
      .run();

    return c.json({ success: true, message: "Printer part deleted successfully" });
  }
);
