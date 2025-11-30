/**
 * SKU Routes - Product SKU Management
 *
 * CRUD operations for product SKUs (color/material variants).
 * SKUs are nested under products but can also be accessed directly.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { calculateFinishedGoodStatus } from "../lib/inventory";
import type { ProductSku } from "../types";

export const skus = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createSkuSchema = z.object({
  sku: z.string().min(1).max(100),
  color: z.string().min(1).max(100),
  filament_type: z.string().max(50).optional(),
  hex_code: z
    .string()
    .regex(/^(#[0-9A-Fa-f]{6})?$/, "Invalid hex color code")
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  quantity: z.number().int().min(1).default(1),
  stock_level: z.number().int().min(0).default(0),
  price: z.number().min(0).optional(), // Price in dollars (decimal)
  low_stock_threshold: z.number().int().min(0).default(0),
});

const updateSkuSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  color: z.string().min(1).max(100).optional(),
  filament_type: z.string().max(50).nullable().optional(),
  hex_code: z
    .string()
    .regex(/^(#[0-9A-Fa-f]{6})?$/, "Invalid hex color code")
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val)),
  quantity: z.number().int().min(1).optional(),
  stock_level: z.number().int().min(0).optional(),
  price: z.number().min(0).nullable().optional(), // Price in dollars (decimal)
  low_stock_threshold: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

const stockAdjustSchema = z.object({
  adjustment: z.number().int(), // Can be positive or negative
  reason: z.string().max(500).optional(),
});

// =============================================================================
// LIST SKUs FOR A PRODUCT
// =============================================================================

/**
 * GET /api/v1/products/:productId/skus
 * List all SKUs for a specific product
 */
skus.get(
  "/products/:productId/skus",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("productId");

    // Verify product exists and belongs to tenant
    const product = await c.env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first();

    if (!product) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    const result = await c.env.DB.prepare(
      `SELECT * FROM product_skus
       WHERE product_id = ? AND tenant_id = ?
       ORDER BY sku ASC`
    )
      .bind(productId, tenantId)
      .all<ProductSku>();

    return c.json({
      success: true,
      data: result.results || [],
      meta: {
        total: result.results?.length || 0,
      },
    });
  }
);

// =============================================================================
// GET SINGLE SKU
// =============================================================================

/**
 * GET /api/v1/skus/:id
 * Get a single SKU by ID
 */
skus.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const skuId = c.req.param("id");

  const sku = await c.env.DB.prepare(
    "SELECT * FROM product_skus WHERE id = ? AND tenant_id = ?"
  )
    .bind(skuId, tenantId)
    .first<ProductSku>();

  if (!sku) {
    throw new ApiError("SKU not found", 404, "SKU_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: sku,
  });
});

// =============================================================================
// CREATE SKU
// =============================================================================

/**
 * POST /api/v1/products/:productId/skus
 * Create a new SKU for a product
 */
skus.post(
  "/products/:productId/skus",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("productId");

    // Verify product exists and belongs to tenant
    const product = await c.env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first();

    if (!product) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof createSkuSchema>;
    try {
      const rawBody = await c.req.json();
      body = createSkuSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate SKU code within tenant
    const existingSku = await c.env.DB.prepare(
      "SELECT id FROM product_skus WHERE tenant_id = ? AND sku = ?"
    )
      .bind(tenantId, body.sku)
      .first();

    if (existingSku) {
      throw new ApiError(
        "A SKU with this code already exists",
        409,
        "DUPLICATE_SKU"
      );
    }

    const skuId = generateId();
    const now = new Date().toISOString();

    // Create SKU and corresponding finished_goods record in a batch
    const finishedGoodId = generateId();
    const status = calculateFinishedGoodStatus(0, body.low_stock_threshold, 0);

    await c.env.DB.batch([
      // Create the SKU
      c.env.DB.prepare(
        `INSERT INTO product_skus (
          id, product_id, tenant_id, sku, color, filament_type, hex_code,
          quantity, stock_level, price, low_stock_threshold, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(
        skuId,
        productId,
        tenantId,
        body.sku,
        body.color,
        body.filament_type || null,
        body.hex_code || null,
        body.quantity,
        body.stock_level,
        body.price ?? null,
        body.low_stock_threshold,
        now,
        now
      ),
      // Create corresponding finished_goods record
      c.env.DB.prepare(
        `INSERT INTO finished_goods (
          id, tenant_id, product_sku_id, print_job_id,
          sku, color, material,
          current_stock, low_stock_threshold, quantity_per_sku,
          unit_price, extra_cost, profit_margin,
          requires_assembly, quantity_assembled, quantity_needs_assembly,
          status, assembly_status, image_url, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        finishedGoodId,
        tenantId,
        skuId,
        null, // print_job_id
        body.sku,
        body.color,
        body.filament_type || "PLA",
        0, // current_stock starts at 0
        body.low_stock_threshold,
        body.quantity,
        body.price ?? 0,
        0, // extra_cost
        0, // profit_margin
        0, // requires_assembly - will be inherited from product if needed
        0, // quantity_assembled
        0, // quantity_needs_assembly
        status,
        "printed", // assembly_status
        null, // image_url
        1, // is_active
        now,
        now
      ),
    ]);

    // Fetch the created SKU
    const sku = await c.env.DB.prepare(
      "SELECT * FROM product_skus WHERE id = ?"
    )
      .bind(skuId)
      .first<ProductSku>();

    return c.json(
      {
        success: true,
        data: sku,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE SKU
// =============================================================================

/**
 * PUT /api/v1/skus/:id
 * Update a SKU
 */
skus.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const skuId = c.req.param("id");

    // Check SKU exists
    const existing = await c.env.DB.prepare(
      "SELECT id, product_id FROM product_skus WHERE id = ? AND tenant_id = ?"
    )
      .bind(skuId, tenantId)
      .first<{ id: string; product_id: string }>();

    if (!existing) {
      throw new ApiError("SKU not found", 404, "SKU_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateSkuSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateSkuSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate SKU code if changing
    if (body.sku) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM product_skus WHERE tenant_id = ? AND sku = ? AND id != ?"
      )
        .bind(tenantId, body.sku, skuId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A SKU with this code already exists",
          409,
          "DUPLICATE_SKU"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const fields: Array<{
      key: keyof typeof body;
      column: string;
      transform?: (v: unknown) => unknown;
    }> = [
      { key: "sku", column: "sku" },
      { key: "color", column: "color" },
      { key: "filament_type", column: "filament_type" },
      { key: "hex_code", column: "hex_code" },
      { key: "quantity", column: "quantity" },
      { key: "stock_level", column: "stock_level" },
      { key: "price", column: "price" },
      { key: "low_stock_threshold", column: "low_stock_threshold" },
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

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(skuId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE product_skus SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Sync changes to finished_goods record if relevant fields changed
    const fgUpdates: string[] = [];
    const fgValues: (string | number | null)[] = [];

    if (body.sku !== undefined) {
      fgUpdates.push("sku = ?");
      fgValues.push(body.sku);
    }
    if (body.color !== undefined) {
      fgUpdates.push("color = ?");
      fgValues.push(body.color);
    }
    if (body.filament_type !== undefined) {
      fgUpdates.push("material = ?");
      fgValues.push(body.filament_type);
    }
    if (body.price !== undefined) {
      fgUpdates.push("unit_price = ?");
      fgValues.push(body.price);
    }
    if (body.low_stock_threshold !== undefined) {
      fgUpdates.push("low_stock_threshold = ?");
      fgValues.push(body.low_stock_threshold);
    }
    if (body.quantity !== undefined) {
      fgUpdates.push("quantity_per_sku = ?");
      fgValues.push(body.quantity);
    }
    if (body.is_active !== undefined) {
      fgUpdates.push("is_active = ?");
      fgValues.push(body.is_active ? 1 : 0);
    }

    if (fgUpdates.length > 0) {
      fgUpdates.push("updated_at = ?");
      fgValues.push(new Date().toISOString());
      fgValues.push(skuId);
      fgValues.push(tenantId);

      await c.env.DB.prepare(
        `UPDATE finished_goods SET ${fgUpdates.join(", ")} WHERE product_sku_id = ? AND tenant_id = ?`
      )
        .bind(...fgValues)
        .run();
    }

    // Fetch updated SKU
    const sku = await c.env.DB.prepare(
      "SELECT * FROM product_skus WHERE id = ?"
    )
      .bind(skuId)
      .first<ProductSku>();

    return c.json({
      success: true,
      data: sku,
    });
  }
);

// =============================================================================
// DELETE SKU
// =============================================================================

/**
 * DELETE /api/v1/skus/:id
 * Delete a SKU
 */
skus.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const skuId = c.req.param("id");

    // Check SKU exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM product_skus WHERE id = ? AND tenant_id = ?"
    )
      .bind(skuId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("SKU not found", 404, "SKU_NOT_FOUND");
    }

    // Delete the SKU and its corresponding finished_goods record
    await c.env.DB.batch([
      // Delete finished_goods record first (references SKU)
      c.env.DB.prepare(
        "DELETE FROM finished_goods WHERE product_sku_id = ? AND tenant_id = ?"
      ).bind(skuId, tenantId),
      // Delete the SKU
      c.env.DB.prepare(
        "DELETE FROM product_skus WHERE id = ? AND tenant_id = ?"
      ).bind(skuId, tenantId),
    ]);

    return c.json({
      success: true,
      message: "SKU deleted successfully",
    });
  }
);

// =============================================================================
// ADJUST STOCK LEVEL
// =============================================================================

/**
 * POST /api/v1/skus/:id/adjust
 * Adjust stock level (increment or decrement)
 */
skus.post(
  "/:id/adjust",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const skuId = c.req.param("id");

    // Check SKU exists
    const existing = await c.env.DB.prepare(
      "SELECT id, stock_level, low_stock_threshold FROM product_skus WHERE id = ? AND tenant_id = ?"
    )
      .bind(skuId, tenantId)
      .first<{ id: string; stock_level: number; low_stock_threshold: number }>();

    if (!existing) {
      throw new ApiError("SKU not found", 404, "SKU_NOT_FOUND");
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

    const newStockLevel = existing.stock_level + body.adjustment;

    if (newStockLevel < 0) {
      throw new ApiError(
        "Stock level cannot go below zero",
        400,
        "INVALID_STOCK_LEVEL"
      );
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "UPDATE product_skus SET stock_level = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    )
      .bind(newStockLevel, now, skuId, tenantId)
      .run();

    // Check if low stock alert should be triggered
    const isLowStock = newStockLevel <= existing.low_stock_threshold;

    return c.json({
      success: true,
      data: {
        id: skuId,
        previous_stock_level: existing.stock_level,
        adjustment: body.adjustment,
        new_stock_level: newStockLevel,
        is_low_stock: isLowStock,
      },
    });
  }
);

// =============================================================================
// LIST ALL SKUs (with filters)
// =============================================================================

/**
 * GET /api/v1/skus
 * List all SKUs for the tenant with optional filters
 * Includes finished_goods_stock (total current_stock from finished_goods)
 */
skus.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const productId = c.req.query("product_id");
  const color = c.req.query("color");
  const filamentType = c.req.query("filament_type");
  const lowStock = c.req.query("low_stock"); // true to filter only low stock items
  const isActive = c.req.query("is_active");

  // Use LEFT JOIN to include finished_goods stock
  let query = `
    SELECT ps.*,
           COALESCE(SUM(fg.current_stock), 0) as finished_goods_stock
    FROM product_skus ps
    LEFT JOIN finished_goods fg ON fg.product_sku_id = ps.id AND fg.is_active = 1
    WHERE ps.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (productId) {
    query += " AND ps.product_id = ?";
    params.push(productId);
  }

  if (color) {
    query += " AND ps.color = ?";
    params.push(color);
  }

  if (filamentType) {
    query += " AND ps.filament_type = ?";
    params.push(filamentType);
  }

  if (lowStock === "true") {
    query += " AND ps.stock_level <= ps.low_stock_threshold";
  }

  if (isActive !== undefined) {
    query += " AND ps.is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  query += " GROUP BY ps.id ORDER BY ps.sku ASC";

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<ProductSku & { finished_goods_stock: number }>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: result.results?.length || 0,
    },
  });
});

// =============================================================================
// GET LOW STOCK SKUs
// =============================================================================

/**
 * GET /api/v1/skus/low-stock
 * Get all SKUs that are at or below their low stock threshold
 */
skus.get("/low-stock", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT ps.*, p.name as product_name
     FROM product_skus ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.tenant_id = ? AND ps.stock_level <= ps.low_stock_threshold AND ps.is_active = 1
     ORDER BY ps.stock_level ASC`
  )
    .bind(tenantId)
    .all<ProductSku & { product_name: string }>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: result.results?.length || 0,
    },
  });
});
