/**
 * Product Routes - Product Catalog Management
 *
 * CRUD operations for products with image upload support.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { paginate, getCount } from "../lib/db";
import { calculateFinishedGoodStatus } from "../lib/inventory";
import type { Product, ProductSku } from "../types";

export const products = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  print_file_id: z.string().nullable().optional(),
  file_name: z.string().max(255).nullable().optional(),
  requires_assembly: z.boolean().default(false),
  requires_post_processing: z.boolean().default(false),
  printer_priority: z.array(z.string()).nullable().optional(), // Array of printer IDs
  image_url: z.string().max(500).nullable().optional(),
  wiki_id: z.string().nullable().optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  print_file_id: z.string().nullable().optional(),
  file_name: z.string().max(255).nullable().optional(),
  requires_assembly: z.boolean().optional(),
  requires_post_processing: z.boolean().optional(),
  printer_priority: z.array(z.string()).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  wiki_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

const createSkuSchema = z.object({
  sku: z.string().min(1).max(100),
  color: z.string().min(1).max(100),
  filament_type: z.string().max(50).optional(),
  hex_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color code")
    .optional(),
  quantity: z.number().int().min(1).default(1),
  stock_level: z.number().int().min(0).default(0),
  price: z.number().min(0).optional(), // Price in dollars (frontend sends dollars)
  low_stock_threshold: z.number().int().min(0).default(0),
});

// =============================================================================
// LIST PRODUCTS
// =============================================================================

/**
 * GET /api/v1/products
 * List all products for the current tenant
 * Supports filtering by category, is_active, search
 * Supports pagination
 */
products.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const category = c.req.query("category");
  const isActive = c.req.query("is_active");
  const search = c.req.query("search");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (category) {
    whereClause += " AND category = ?";
    params.push(category);
  }

  if (isActive !== undefined) {
    whereClause += " AND is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  if (search) {
    whereClause += " AND (name LIKE ? OR description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get total count
  const total = await getCount(c.env.DB, "products", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query products
  const query = `
    SELECT * FROM products
    WHERE ${whereClause}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<Product>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: offset + (result.results?.length || 0) < total,
    },
  });
});

// =============================================================================
// GET SINGLE PRODUCT (with SKUs)
// =============================================================================

/**
 * GET /api/v1/products/:id
 * Get a single product by ID, includes all SKUs
 */
products.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const productId = c.req.param("id");

  const product = await c.env.DB.prepare(
    "SELECT * FROM products WHERE id = ? AND tenant_id = ?"
  )
    .bind(productId, tenantId)
    .first<Product>();

  if (!product) {
    throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  // Get all SKUs for this product
  const skusResult = await c.env.DB.prepare(
    "SELECT * FROM product_skus WHERE product_id = ? AND tenant_id = ? ORDER BY sku ASC"
  )
    .bind(productId, tenantId)
    .all<ProductSku>();

  return c.json({
    success: true,
    data: {
      ...product,
      skus: skusResult.results || [],
    },
  });
});

// =============================================================================
// CREATE PRODUCT
// =============================================================================

/**
 * POST /api/v1/products
 * Create a new product
 */
products.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createProductSchema>;
    try {
      const rawBody = await c.req.json();
      body = createProductSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name
    const existing = await c.env.DB.prepare(
      "SELECT id FROM products WHERE tenant_id = ? AND name = ?"
    )
      .bind(tenantId, body.name)
      .first();

    if (existing) {
      throw new ApiError(
        "A product with this name already exists",
        409,
        "DUPLICATE_NAME"
      );
    }

    // If print_file_id provided, validate it belongs to this tenant
    if (body.print_file_id) {
      const file = await c.env.DB.prepare(
        "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.print_file_id, tenantId)
        .first();

      if (!file) {
        throw new ApiError(
          "Print file not found or does not belong to this tenant",
          404,
          "PRINT_FILE_NOT_FOUND"
        );
      }
    }

    const productId = generateId();
    const now = new Date().toISOString();

    // Serialize printer_priority array to JSON
    const printerPriorityJson = body.printer_priority
      ? JSON.stringify(body.printer_priority)
      : null;

    await c.env.DB.prepare(
      `INSERT INTO products (
        id, tenant_id, name, description, category,
        print_file_id, file_name, requires_assembly, requires_post_processing,
        printer_priority, image_url, wiki_id, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(
        productId,
        tenantId,
        body.name,
        body.description || null,
        body.category || null,
        body.print_file_id || null,
        body.file_name || null,
        body.requires_assembly ? 1 : 0,
        body.requires_post_processing ? 1 : 0,
        printerPriorityJson,
        body.image_url || null,
        body.wiki_id || null,
        now,
        now
      )
      .run();

    // Fetch the created product
    const product = await c.env.DB.prepare(
      "SELECT * FROM products WHERE id = ?"
    )
      .bind(productId)
      .first<Product>();

    return c.json(
      {
        success: true,
        data: product,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE PRODUCT
// =============================================================================

/**
 * PUT /api/v1/products/:id
 * Update a product
 */
products.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

    // Check product exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateProductSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateProductSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name if name is being changed
    if (body.name) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM products WHERE tenant_id = ? AND name = ? AND id != ?"
      )
        .bind(tenantId, body.name, productId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A product with this name already exists",
          409,
          "DUPLICATE_NAME"
        );
      }
    }

    // Validate print_file_id if provided
    if (body.print_file_id) {
      const file = await c.env.DB.prepare(
        "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.print_file_id, tenantId)
        .first();

      if (!file) {
        throw new ApiError(
          "Print file not found or does not belong to this tenant",
          404,
          "PRINT_FILE_NOT_FOUND"
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
      { key: "name", column: "name" },
      { key: "description", column: "description" },
      { key: "category", column: "category" },
      { key: "print_file_id", column: "print_file_id" },
      { key: "file_name", column: "file_name" },
      {
        key: "requires_assembly",
        column: "requires_assembly",
        transform: (v) => (v ? 1 : 0),
      },
      {
        key: "requires_post_processing",
        column: "requires_post_processing",
        transform: (v) => (v ? 1 : 0),
      },
      {
        key: "printer_priority",
        column: "printer_priority",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      { key: "image_url", column: "image_url" },
      { key: "wiki_id", column: "wiki_id" },
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

    values.push(productId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE products SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated product
    const product = await c.env.DB.prepare(
      "SELECT * FROM products WHERE id = ?"
    )
      .bind(productId)
      .first<Product>();

    return c.json({
      success: true,
      data: product,
    });
  }
);

// =============================================================================
// DELETE PRODUCT
// =============================================================================

/**
 * DELETE /api/v1/products/:id
 * Delete a product (cascades to SKUs via FK constraint)
 */
products.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

    // Check product exists
    const existing = await c.env.DB.prepare(
      "SELECT id, image_url FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first<{ id: string; image_url: string | null }>();

    if (!existing) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Delete product image from R2 if exists
    if (existing.image_url && existing.image_url.startsWith(`${tenantId}/`)) {
      try {
        await c.env.R2.delete(existing.image_url);
      } catch {
        // Ignore R2 deletion errors
      }
    }

    // Delete the product (SKUs cascade automatically)
    await c.env.DB.prepare(
      "DELETE FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Product deleted successfully",
    });
  }
);

// =============================================================================
// UPLOAD PRODUCT IMAGE
// =============================================================================

/**
 * POST /api/v1/products/:id/image
 * Upload a product image to R2
 */
products.post(
  "/:id/image",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

    // Check product exists
    const existing = await c.env.DB.prepare(
      "SELECT id, image_url FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first<{ id: string; image_url: string | null }>();

    if (!existing) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Get the uploaded file
    const contentType = c.req.header("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      throw new ApiError(
        "Content-Type must be multipart/form-data",
        400,
        "INVALID_CONTENT_TYPE"
      );
    }

    const formData = await c.req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      throw new ApiError("No image file provided", 400, "NO_FILE");
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      throw new ApiError(
        "Invalid image type. Allowed: JPEG, PNG, WebP, GIF",
        400,
        "INVALID_FILE_TYPE"
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new ApiError(
        "Image too large. Maximum size is 5MB",
        400,
        "FILE_TOO_LARGE"
      );
    }

    // Delete old image if exists
    if (existing.image_url && existing.image_url.startsWith(`${tenantId}/`)) {
      try {
        await c.env.R2.delete(existing.image_url);
      } catch {
        // Ignore deletion errors
      }
    }

    // Generate R2 key
    const extension = file.name.split(".").pop() || "jpg";
    const r2Key = `${tenantId}/products/${productId}.${extension}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await c.env.R2.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Update product with new image URL
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE products SET image_url = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    )
      .bind(r2Key, now, productId, tenantId)
      .run();

    return c.json({
      success: true,
      data: {
        image_url: r2Key,
      },
    });
  }
);

// =============================================================================
// GET PRODUCT IMAGE
// =============================================================================

/**
 * GET /api/v1/products/:id/image
 * Get product image from R2 (returns the image directly)
 */
products.get("/:id/image", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const productId = c.req.param("id");

  // Get product
  const product = await c.env.DB.prepare(
    "SELECT id, image_url FROM products WHERE id = ? AND tenant_id = ?"
  )
    .bind(productId, tenantId)
    .first<{ id: string; image_url: string | null }>();

  if (!product) {
    throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  if (!product.image_url) {
    throw new ApiError("Product has no image", 404, "NO_IMAGE");
  }

  // Get image from R2
  const object = await c.env.R2.get(product.image_url);

  if (!object) {
    throw new ApiError("Image not found in storage", 404, "IMAGE_NOT_FOUND");
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType || "image/jpeg"
  );
  headers.set("Cache-Control", "public, max-age=86400"); // Cache for 24 hours

  return new Response(object.body, {
    headers,
  });
});

// =============================================================================
// GET PRODUCT CATEGORIES
// =============================================================================

/**
 * GET /api/v1/products/categories
 * Get list of unique product categories for the tenant
 */
products.get("/categories", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT DISTINCT category FROM products
     WHERE tenant_id = ? AND category IS NOT NULL AND category != ''
     ORDER BY category ASC`
  )
    .bind(tenantId)
    .all<{ category: string }>();

  const categories = (result.results || []).map((r) => r.category);

  return c.json({
    success: true,
    data: categories,
  });
});

// =============================================================================
// CREATE SKU FOR PRODUCT
// =============================================================================

/**
 * POST /api/v1/products/:id/skus
 * Create a new SKU for a product
 */
products.post(
  "/:id/skus",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

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
        0, // requires_assembly
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
// PRODUCT COMPONENTS - Assembly component management
// =============================================================================

const componentSchema = z.object({
  component_name: z.string().min(1).max(200),
  component_type: z.string().max(100).nullable().optional(),
  quantity_required: z.number().int().min(1).default(1),
  notes: z.string().max(500).nullable().optional(),
});

const createComponentsSchema = z.object({
  components: z.array(componentSchema).min(1),
  replace: z.boolean().default(false),
});

/**
 * GET /api/v1/products/:id/components
 * List all assembly components for a product
 */
products.get(
  "/:id/components",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

    // Verify product exists and belongs to tenant
    const product = await c.env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first();

    if (!product) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Get all components for this product
    const result = await c.env.DB.prepare(
      "SELECT * FROM product_components WHERE product_id = ? ORDER BY component_name ASC"
    )
      .bind(productId)
      .all();

    return c.json({
      success: true,
      data: result.results || [],
    });
  }
);

/**
 * POST /api/v1/products/:id/components
 * Create assembly components for a product (supports bulk create/replace)
 */
products.post(
  "/:id/components",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

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
    let body: z.infer<typeof createComponentsSchema>;
    try {
      const rawBody = await c.req.json();
      body = createComponentsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();

    // If replace mode, delete existing components first
    if (body.replace) {
      await c.env.DB.prepare("DELETE FROM product_components WHERE product_id = ?")
        .bind(productId)
        .run();
    }

    // Insert new components using batch
    const insertStatements = body.components.map((comp) => {
      const componentId = generateId();
      return c.env.DB.prepare(
        `INSERT INTO product_components (id, product_id, component_name, component_type, quantity_required, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        componentId,
        productId,
        comp.component_name,
        comp.component_type || null,
        comp.quantity_required,
        comp.notes || null,
        now
      );
    });

    if (insertStatements.length > 0) {
      await c.env.DB.batch(insertStatements);
    }

    // Fetch all components for this product
    const result = await c.env.DB.prepare(
      "SELECT * FROM product_components WHERE product_id = ? ORDER BY component_name ASC"
    )
      .bind(productId)
      .all();

    return c.json(
      {
        success: true,
        data: result.results || [],
      },
      201
    );
  }
);

/**
 * DELETE /api/v1/products/:id/components
 * Delete all assembly components for a product
 */
products.delete(
  "/:id/components",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const productId = c.req.param("id");

    // Verify product exists and belongs to tenant
    const product = await c.env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
    )
      .bind(productId, tenantId)
      .first();

    if (!product) {
      throw new ApiError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    // Delete all components for this product
    await c.env.DB.prepare("DELETE FROM product_components WHERE product_id = ?")
      .bind(productId)
      .run();

    return c.json({
      success: true,
      message: "Components deleted successfully",
    });
  }
);

/**
 * GET /api/v1/products/components/all
 * List all assembly components for the tenant (bulk fetch for product list)
 * This endpoint returns all components grouped by product_id for efficient frontend loading
 */
products.get(
  "/components/all",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Get all components for products belonging to this tenant
    const result = await c.env.DB.prepare(
      `SELECT pc.* FROM product_components pc
       INNER JOIN products p ON pc.product_id = p.id
       WHERE p.tenant_id = ?
       ORDER BY pc.product_id, pc.component_name ASC`
    )
      .bind(tenantId)
      .all();

    return c.json({
      success: true,
      data: result.results || [],
    });
  }
);

