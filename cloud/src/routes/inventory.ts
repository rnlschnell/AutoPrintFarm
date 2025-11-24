/**
 * Inventory Routes - Finished Goods Management
 *
 * CRUD operations for finished goods inventory tracking.
 * Includes stock management, low stock alerts, and inventory statistics.
 * All routes are tenant-scoped.
 *
 * Phase 9: Inventory & Finished Goods API
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import {
  calculateFinishedGoodStatus,
  validateStockAdjustment,
  createLowStockAlert,
  type InventoryStats,
} from "../lib/inventory";
import type { FinishedGood, ProductSku } from "../types";

export const inventory = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const assemblyStatusEnum = z.enum(["printed", "needs_assembly", "assembled"]);

const createInventorySchema = z.object({
  product_sku_id: z.string().uuid(),
  current_stock: z.number().int().min(0).default(0),
  low_stock_threshold: z.number().int().min(0).default(5),
  quantity_per_sku: z.number().int().min(1).default(1),
  unit_price: z.number().int().min(0).default(0), // Price in cents
  extra_cost: z.number().int().min(0).default(0),
  profit_margin: z.number().int().min(0).max(10000).default(0), // Percentage * 100
  requires_assembly: z.boolean().default(false),
  quantity_assembled: z.number().int().min(0).default(0),
  quantity_needs_assembly: z.number().int().min(0).default(0),
  image_url: z.string().url().nullable().optional(),
});

const updateInventorySchema = z.object({
  current_stock: z.number().int().min(0).optional(),
  low_stock_threshold: z.number().int().min(0).optional(),
  quantity_per_sku: z.number().int().min(1).optional(),
  unit_price: z.number().int().min(0).optional(),
  extra_cost: z.number().int().min(0).optional(),
  profit_margin: z.number().int().min(0).max(10000).optional(),
  requires_assembly: z.boolean().optional(),
  quantity_assembled: z.number().int().min(0).optional(),
  quantity_needs_assembly: z.number().int().min(0).optional(),
  assembly_status: assemblyStatusEnum.optional(),
  image_url: z.string().url().nullable().optional(),
  is_active: z.boolean().optional(),
});

const stockAdjustSchema = z.object({
  adjustment: z.number().int(), // Can be positive or negative
  reason: z
    .enum([
      "manual",
      "print_completion",
      "order_fulfillment",
      "correction",
      "assembly_completed",
      "damaged",
      "returned",
      "inventory_count",
    ])
    .default("manual"),
  notes: z.string().max(500).optional(),
});

const thresholdUpdateSchema = z.object({
  low_stock_threshold: z.number().int().min(0),
});

// =============================================================================
// LIST FINISHED GOODS
// =============================================================================

/**
 * GET /api/v1/inventory
 * List finished goods with optional filters and pagination
 */
inventory.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Query parameters
  const status = c.req.query("status");
  const lowStock = c.req.query("low_stock");
  const productSkuId = c.req.query("product_sku_id");
  const requiresAssembly = c.req.query("requires_assembly");
  const isActive = c.req.query("is_active");
  const search = c.req.query("search");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = (page - 1) * limit;

  // Build query
  let query = `SELECT fg.*, ps.product_id
               FROM finished_goods fg
               LEFT JOIN product_skus ps ON fg.product_sku_id = ps.id
               WHERE fg.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (status) {
    query += " AND fg.status = ?";
    params.push(status);
  }

  if (lowStock === "true") {
    query += " AND fg.current_stock <= fg.low_stock_threshold AND fg.is_active = 1";
  }

  if (productSkuId) {
    query += " AND fg.product_sku_id = ?";
    params.push(productSkuId);
  }

  if (requiresAssembly !== undefined) {
    query += " AND fg.requires_assembly = ?";
    params.push(requiresAssembly === "true" ? 1 : 0);
  }

  if (isActive !== undefined) {
    query += " AND fg.is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  if (search) {
    query += " AND (fg.sku LIKE ? OR fg.color LIKE ? OR fg.material LIKE ?)";
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Get total count
  const countQuery = query.replace(
    "SELECT fg.*, ps.product_id",
    "SELECT COUNT(*) as count"
  );
  const countResult = await c.env.DB.prepare(countQuery)
    .bind(...params)
    .first<{ count: number }>();
  const total = countResult?.count || 0;

  // Add pagination and ordering
  query += " ORDER BY fg.updated_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<FinishedGood & { product_id: string | null }>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      page,
      limit,
      total,
      hasMore: offset + limit < total,
    },
  });
});

// =============================================================================
// GET SINGLE FINISHED GOOD
// =============================================================================

/**
 * GET /api/v1/inventory/:id
 * Get a single finished good with related SKU/product info
 */
inventory.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const inventoryId = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT fg.*,
            ps.product_id, ps.quantity as sku_quantity, ps.hex_code,
            p.name as product_name, p.category as product_category
     FROM finished_goods fg
     LEFT JOIN product_skus ps ON fg.product_sku_id = ps.id
     LEFT JOIN products p ON ps.product_id = p.id
     WHERE fg.id = ? AND fg.tenant_id = ?`
  )
    .bind(inventoryId, tenantId)
    .first<
      FinishedGood & {
        product_id: string | null;
        sku_quantity: number | null;
        hex_code: string | null;
        product_name: string | null;
        product_category: string | null;
      }
    >();

  if (!result) {
    throw new ApiError("Inventory item not found", 404, "INVENTORY_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: result,
  });
});

// =============================================================================
// CREATE FINISHED GOOD
// =============================================================================

/**
 * POST /api/v1/inventory
 * Create a new finished good record manually
 */
inventory.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createInventorySchema>;
    try {
      const rawBody = await c.req.json();
      body = createInventorySchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Verify the SKU exists and belongs to tenant
    const sku = await c.env.DB.prepare(
      "SELECT * FROM product_skus WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.product_sku_id, tenantId)
      .first<ProductSku>();

    if (!sku) {
      throw new ApiError("Product SKU not found", 404, "SKU_NOT_FOUND");
    }

    // Check if finished good already exists for this SKU
    const existing = await c.env.DB.prepare(
      "SELECT id FROM finished_goods WHERE product_sku_id = ? AND tenant_id = ?"
    )
      .bind(body.product_sku_id, tenantId)
      .first();

    if (existing) {
      throw new ApiError(
        "A finished good record already exists for this SKU",
        409,
        "DUPLICATE_INVENTORY"
      );
    }

    // Calculate initial status
    const status = calculateFinishedGoodStatus(
      body.current_stock,
      body.low_stock_threshold,
      body.quantity_needs_assembly
    );

    // Determine assembly status
    let assemblyStatus: "printed" | "needs_assembly" | "assembled" = "printed";
    if (body.requires_assembly && body.quantity_needs_assembly > 0) {
      assemblyStatus = "needs_assembly";
    } else if (body.quantity_assembled > 0) {
      assemblyStatus = "assembled";
    }

    const inventoryId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO finished_goods (
        id, tenant_id, product_sku_id, print_job_id,
        sku, color, material,
        current_stock, low_stock_threshold, quantity_per_sku,
        unit_price, extra_cost, profit_margin,
        requires_assembly, quantity_assembled, quantity_needs_assembly,
        status, assembly_status, image_url, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        inventoryId,
        tenantId,
        body.product_sku_id,
        null, // print_job_id - manual creation has no associated job
        sku.sku,
        sku.color,
        sku.filament_type || "PLA",
        body.current_stock,
        body.low_stock_threshold,
        body.quantity_per_sku,
        body.unit_price,
        body.extra_cost,
        body.profit_margin,
        body.requires_assembly ? 1 : 0,
        body.quantity_assembled,
        body.quantity_needs_assembly,
        status,
        assemblyStatus,
        body.image_url || null,
        1,
        now,
        now
      )
      .run();

    // Fetch the created record
    const created = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ?"
    )
      .bind(inventoryId)
      .first<FinishedGood>();

    return c.json(
      {
        success: true,
        data: created,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE FINISHED GOOD
// =============================================================================

/**
 * PUT /api/v1/inventory/:id
 * Update a finished good's properties
 */
inventory.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const inventoryId = c.req.param("id");

    // Check inventory item exists
    const existing = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
    )
      .bind(inventoryId, tenantId)
      .first<FinishedGood>();

    if (!existing) {
      throw new ApiError("Inventory item not found", 404, "INVENTORY_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateInventorySchema>;
    try {
      const rawBody = await c.req.json();
      body = updateInventorySchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const fields: Array<{
      key: keyof typeof body;
      column: string;
      transform?: (v: unknown) => unknown;
    }> = [
      { key: "current_stock", column: "current_stock" },
      { key: "low_stock_threshold", column: "low_stock_threshold" },
      { key: "quantity_per_sku", column: "quantity_per_sku" },
      { key: "unit_price", column: "unit_price" },
      { key: "extra_cost", column: "extra_cost" },
      { key: "profit_margin", column: "profit_margin" },
      { key: "requires_assembly", column: "requires_assembly", transform: (v) => (v ? 1 : 0) },
      { key: "quantity_assembled", column: "quantity_assembled" },
      { key: "quantity_needs_assembly", column: "quantity_needs_assembly" },
      { key: "assembly_status", column: "assembly_status" },
      { key: "image_url", column: "image_url" },
      { key: "is_active", column: "is_active", transform: (v) => (v ? 1 : 0) },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        const value = body[field.key];
        values.push(
          field.transform
            ? (field.transform(value) as string | number | null)
            : (value as string | number | null)
        );
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    // Calculate new status if stock-related fields changed
    const newStock = body.current_stock ?? existing.current_stock;
    const newThreshold = body.low_stock_threshold ?? existing.low_stock_threshold;
    const newNeedsAssembly = body.quantity_needs_assembly ?? existing.quantity_needs_assembly;
    const newStatus = calculateFinishedGoodStatus(newStock, newThreshold, newNeedsAssembly);

    updates.push("status = ?");
    values.push(newStatus);

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(inventoryId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE finished_goods SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated record
    const updated = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ?"
    )
      .bind(inventoryId)
      .first<FinishedGood>();

    return c.json({
      success: true,
      data: updated,
    });
  }
);

// =============================================================================
// ADJUST STOCK
// =============================================================================

/**
 * POST /api/v1/inventory/:id/adjust
 * Adjust stock level (increment or decrement) with reason tracking
 */
inventory.post(
  "/:id/adjust",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const inventoryId = c.req.param("id");

    // Check inventory item exists
    const existing = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
    )
      .bind(inventoryId, tenantId)
      .first<FinishedGood>();

    if (!existing) {
      throw new ApiError("Inventory item not found", 404, "INVENTORY_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof stockAdjustSchema>;
    try {
      const rawBody = await c.req.json();
      body = stockAdjustSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate the adjustment
    const validation = validateStockAdjustment(existing.current_stock, body.adjustment);
    if (!validation.valid) {
      throw new ApiError(
        validation.message || "Invalid stock adjustment",
        400,
        "INVALID_STOCK_ADJUSTMENT"
      );
    }

    const newStock = existing.current_stock + body.adjustment;
    const newStatus = calculateFinishedGoodStatus(
      newStock,
      existing.low_stock_threshold,
      existing.quantity_needs_assembly
    );
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE finished_goods
       SET current_stock = ?, status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(newStock, newStatus, now, inventoryId, tenantId)
      .run();

    // Log the adjustment to audit_logs if available
    // This is optional tracking for compliance
    try {
      const user = c.get("user");
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          generateId(),
          tenantId,
          user?.id || null,
          "stock_adjustment",
          "finished_good",
          inventoryId,
          JSON.stringify({
            previous_stock: existing.current_stock,
            adjustment: body.adjustment,
            new_stock: newStock,
            reason: body.reason,
            notes: body.notes,
          }),
          now
        )
        .run();
    } catch {
      // Audit logging is optional, don't fail the request
      console.warn("Failed to create audit log for stock adjustment");
    }

    return c.json({
      success: true,
      data: {
        id: inventoryId,
        previous_stock: existing.current_stock,
        adjustment: body.adjustment,
        new_stock: newStock,
        previous_status: existing.status,
        new_status: newStatus,
        is_low_stock: newStock <= existing.low_stock_threshold,
        reason: body.reason,
      },
    });
  }
);

// =============================================================================
// DELETE FINISHED GOOD
// =============================================================================

/**
 * DELETE /api/v1/inventory/:id
 * Delete a finished good record (soft delete by setting is_active = 0)
 */
inventory.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const inventoryId = c.req.param("id");

    // Check inventory item exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM finished_goods WHERE id = ? AND tenant_id = ?"
    )
      .bind(inventoryId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Inventory item not found", 404, "INVENTORY_NOT_FOUND");
    }

    // Soft delete by marking as discontinued and inactive
    await c.env.DB.prepare(
      `UPDATE finished_goods
       SET is_active = 0, status = 'discontinued', updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), inventoryId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Inventory item deleted successfully",
    });
  }
);

// =============================================================================
// LOW STOCK ALERTS
// =============================================================================

/**
 * GET /api/v1/inventory/alerts
 * Get all items that are at or below their low stock threshold
 */
inventory.get("/alerts", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT fg.*, p.name as product_name
     FROM finished_goods fg
     LEFT JOIN product_skus ps ON fg.product_sku_id = ps.id
     LEFT JOIN products p ON ps.product_id = p.id
     WHERE fg.tenant_id = ?
       AND fg.current_stock <= fg.low_stock_threshold
       AND fg.is_active = 1
     ORDER BY (fg.low_stock_threshold - fg.current_stock) DESC, fg.sku ASC`
  )
    .bind(tenantId)
    .all<FinishedGood & { product_name: string | null }>();

  const alerts = (result.results || []).map((item) => ({
    ...createLowStockAlert(item),
    product_name: item.product_name,
  }));

  return c.json({
    success: true,
    data: alerts,
    meta: {
      total: alerts.length,
    },
  });
});

// =============================================================================
// UPDATE THRESHOLD
// =============================================================================

/**
 * PUT /api/v1/inventory/:id/threshold
 * Update the low stock threshold for an item
 */
inventory.put(
  "/:id/threshold",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const inventoryId = c.req.param("id");

    // Check inventory item exists
    const existing = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
    )
      .bind(inventoryId, tenantId)
      .first<FinishedGood>();

    if (!existing) {
      throw new ApiError("Inventory item not found", 404, "INVENTORY_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof thresholdUpdateSchema>;
    try {
      const rawBody = await c.req.json();
      body = thresholdUpdateSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Calculate new status based on new threshold
    const newStatus = calculateFinishedGoodStatus(
      existing.current_stock,
      body.low_stock_threshold,
      existing.quantity_needs_assembly
    );
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE finished_goods
       SET low_stock_threshold = ?, status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(body.low_stock_threshold, newStatus, now, inventoryId, tenantId)
      .run();

    // Fetch updated record
    const updated = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ?"
    )
      .bind(inventoryId)
      .first<FinishedGood>();

    return c.json({
      success: true,
      data: updated,
    });
  }
);

// =============================================================================
// INVENTORY STATISTICS
// =============================================================================

/**
 * GET /api/v1/inventory/stats
 * Get aggregated inventory statistics
 */
inventory.get("/stats", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Get aggregated stats
  const statsResult = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total_items,
       COALESCE(SUM(current_stock), 0) as total_stock,
       COALESCE(SUM(current_stock * unit_price), 0) as total_value,
       COALESCE(SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END), 0) as in_stock_count,
       COALESCE(SUM(CASE WHEN status = 'low_stock' THEN 1 ELSE 0 END), 0) as low_stock_count,
       COALESCE(SUM(CASE WHEN status = 'out_of_stock' THEN 1 ELSE 0 END), 0) as out_of_stock_count,
       COALESCE(SUM(CASE WHEN status = 'needs_assembly' THEN 1 ELSE 0 END), 0) as needs_assembly_count,
       COALESCE(SUM(quantity_needs_assembly), 0) as total_needs_assembly,
       COALESCE(SUM(quantity_assembled), 0) as total_assembled
     FROM finished_goods
     WHERE tenant_id = ? AND is_active = 1`
  )
    .bind(tenantId)
    .first<InventoryStats>();

  const stats: InventoryStats = {
    total_items: statsResult?.total_items || 0,
    total_stock: statsResult?.total_stock || 0,
    total_value: statsResult?.total_value || 0,
    in_stock_count: statsResult?.in_stock_count || 0,
    low_stock_count: statsResult?.low_stock_count || 0,
    out_of_stock_count: statsResult?.out_of_stock_count || 0,
    needs_assembly_count: statsResult?.needs_assembly_count || 0,
    total_needs_assembly: statsResult?.total_needs_assembly || 0,
    total_assembled: statsResult?.total_assembled || 0,
  };

  return c.json({
    success: true,
    data: stats,
  });
});
