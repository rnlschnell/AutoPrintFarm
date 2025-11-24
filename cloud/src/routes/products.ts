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
import type { Product, ProductSku } from "../types";

export const products = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  print_file_id: z.string().optional(),
  file_name: z.string().max(255).optional(),
  requires_assembly: z.boolean().default(false),
  requires_post_processing: z.boolean().default(false),
  printer_priority: z.array(z.string()).optional(), // Array of printer IDs
  image_url: z.string().max(500).optional(),
  wiki_id: z.string().optional(),
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
