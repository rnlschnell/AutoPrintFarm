/**
 * Orders Routes - Order Management API
 *
 * CRUD operations for customer orders from various platforms.
 * Includes order fulfillment, status tracking, and item management.
 * All routes are tenant-scoped.
 *
 * Phase 10: Orders & Shopify Integration
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import {
  validateFulfillmentQuantity,
  calculateOrderStatus,
  calculateItemFulfillmentStatus,
  generateOrderNumber,
  type OrderStats,
} from "../lib/orders";
import type { Order, OrderItem, FinishedGood } from "../types";

export const orders = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const platformEnum = z.enum(["shopify", "amazon", "etsy", "manual", "other"]);

const orderStatusEnum = z.enum([
  "pending",
  "processing",
  "printed",
  "assembled",
  "shipped",
  "fulfilled",
  "cancelled",
  "refunded",
]);

const orderItemSchema = z.object({
  product_sku_id: z.string().uuid().optional(),
  finished_good_id: z.string().uuid().optional(),
  sku: z.string().min(1).max(100),
  product_name: z.string().min(1).max(255),
  quantity: z.number().int().min(1),
  unit_price: z.number().int().min(0), // Price in cents
  notes: z.string().max(500).optional(),
});

const createOrderSchema = z.object({
  order_number: z.string().min(1).max(100).optional(), // Auto-generated if not provided
  platform: platformEnum.default("manual"),
  customer_name: z.string().min(1).max(255),
  customer_email: z.string().email().max(255).optional(),
  customer_phone: z.string().max(50).optional(),
  order_date: z.string().datetime().optional(), // ISO8601, defaults to now
  total_revenue: z.number().int().min(0).optional(), // Auto-calculated if not provided
  shipping_cost: z.number().int().min(0).default(0),
  tax_amount: z.number().int().min(0).default(0),
  discount_amount: z.number().int().min(0).default(0),
  shipping_street: z.string().max(255).optional(),
  shipping_city: z.string().max(100).optional(),
  shipping_state: z.string().max(100).optional(),
  shipping_zip: z.string().max(20).optional(),
  shipping_country: z.string().max(100).default("USA"),
  external_id: z.string().max(100).optional(),
  external_data: z.record(z.unknown()).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1),
});

const updateOrderSchema = z.object({
  customer_name: z.string().min(1).max(255).optional(),
  customer_email: z.string().email().max(255).optional(),
  customer_phone: z.string().max(50).optional(),
  status: orderStatusEnum.optional(),
  shipping_cost: z.number().int().min(0).optional(),
  tax_amount: z.number().int().min(0).optional(),
  discount_amount: z.number().int().min(0).optional(),
  shipping_street: z.string().max(255).optional(),
  shipping_city: z.string().max(100).optional(),
  shipping_state: z.string().max(100).optional(),
  shipping_zip: z.string().max(20).optional(),
  shipping_country: z.string().max(100).optional(),
  tracking_number: z.string().max(100).optional(),
  tracking_url: z.string().url().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const fulfillOrderSchema = z.object({
  tracking_number: z.string().max(100).optional(),
  tracking_url: z.string().url().max(500).optional(),
  notify_customer: z.boolean().default(false),
});

const fulfillItemSchema = z.object({
  quantity: z.number().int().min(1),
});

// =============================================================================
// LIST ORDERS
// =============================================================================

/**
 * GET /api/v1/orders
 * List orders with optional filters and pagination
 */
orders.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Query parameters
  const status = c.req.query("status");
  const platform = c.req.query("platform");
  const search = c.req.query("search");
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = (page - 1) * limit;

  // Build query
  let query = `SELECT * FROM orders WHERE tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  if (platform) {
    query += " AND platform = ?";
    params.push(platform);
  }

  if (search) {
    query += " AND (order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)";
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  if (startDate) {
    query += " AND order_date >= ?";
    params.push(startDate);
  }

  if (endDate) {
    query += " AND order_date <= ?";
    params.push(endDate);
  }

  // Get total count
  const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as count");
  const countResult = await c.env.DB.prepare(countQuery)
    .bind(...params)
    .first<{ count: number }>();
  const total = countResult?.count || 0;

  // Add pagination and ordering
  query += " ORDER BY order_date DESC, created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<Order>();

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
// GET SINGLE ORDER
// =============================================================================

/**
 * GET /api/v1/orders/:id
 * Get a single order with all its items
 */
orders.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const orderId = c.req.param("id");

  // Get order
  const order = await c.env.DB.prepare(
    "SELECT * FROM orders WHERE id = ? AND tenant_id = ?"
  )
    .bind(orderId, tenantId)
    .first<Order>();

  if (!order) {
    throw new ApiError("Order not found", 404, "ORDER_NOT_FOUND");
  }

  // Get order items
  const itemsResult = await c.env.DB.prepare(
    `SELECT oi.*, ps.color, ps.hex_code, p.name as product_display_name
     FROM order_items oi
     LEFT JOIN product_skus ps ON oi.product_sku_id = ps.id
     LEFT JOIN products p ON ps.product_id = p.id
     WHERE oi.order_id = ?
     ORDER BY oi.created_at ASC`
  )
    .bind(orderId)
    .all<OrderItem & { color?: string; hex_code?: string; product_display_name?: string }>();

  return c.json({
    success: true,
    data: {
      ...order,
      items: itemsResult.results || [],
    },
  });
});

// =============================================================================
// CREATE ORDER
// =============================================================================

/**
 * POST /api/v1/orders
 * Create a new order with items
 */
orders.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createOrderSchema>;
    try {
      const rawBody = await c.req.json();
      body = createOrderSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const orderId = generateId();
    const now = new Date().toISOString();
    const orderDate = body.order_date || now;

    // Generate order number if not provided
    const orderNumber = body.order_number || generateOrderNumber(body.platform);

    // Check for duplicate order number
    const existingOrder = await c.env.DB.prepare(
      "SELECT id FROM orders WHERE order_number = ? AND tenant_id = ?"
    )
      .bind(orderNumber, tenantId)
      .first();

    if (existingOrder) {
      throw new ApiError(
        "An order with this number already exists",
        409,
        "DUPLICATE_ORDER_NUMBER"
      );
    }

    // Calculate total revenue from items if not provided
    let totalRevenue = body.total_revenue;
    if (totalRevenue === undefined) {
      totalRevenue = body.items.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0
      );
    }

    // Create order
    await c.env.DB.prepare(
      `INSERT INTO orders (
        id, tenant_id, order_number, platform,
        customer_name, customer_email, customer_phone,
        order_date, status,
        total_revenue, shipping_cost, tax_amount, discount_amount,
        shipping_street, shipping_city, shipping_state, shipping_zip, shipping_country,
        external_id, external_data, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        orderId,
        tenantId,
        orderNumber,
        body.platform,
        body.customer_name,
        body.customer_email || null,
        body.customer_phone || null,
        orderDate,
        "pending",
        totalRevenue,
        body.shipping_cost,
        body.tax_amount,
        body.discount_amount,
        body.shipping_street || null,
        body.shipping_city || null,
        body.shipping_state || null,
        body.shipping_zip || null,
        body.shipping_country,
        body.external_id || null,
        body.external_data ? JSON.stringify(body.external_data) : null,
        body.notes || null,
        now,
        now
      )
      .run();

    // Create order items
    for (const item of body.items) {
      const itemId = generateId();
      const totalPrice = item.quantity * item.unit_price;

      await c.env.DB.prepare(
        `INSERT INTO order_items (
          id, order_id, product_sku_id, finished_good_id,
          sku, product_name, quantity, unit_price, total_price,
          quantity_fulfilled, fulfillment_status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          itemId,
          orderId,
          item.product_sku_id || null,
          item.finished_good_id || null,
          item.sku,
          item.product_name,
          item.quantity,
          item.unit_price,
          totalPrice,
          0, // quantity_fulfilled
          "pending", // fulfillment_status
          item.notes || null,
          now
        )
        .run();
    }

    // Fetch the created order with items
    const createdOrder = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ?"
    )
      .bind(orderId)
      .first<Order>();

    const createdItems = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    )
      .bind(orderId)
      .all<OrderItem>();

    return c.json(
      {
        success: true,
        data: {
          ...createdOrder,
          items: createdItems.results || [],
        },
      },
      201
    );
  }
);

// =============================================================================
// UPDATE ORDER
// =============================================================================

/**
 * PUT /api/v1/orders/:id
 * Update order details (not items)
 */
orders.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const orderId = c.req.param("id");

    // Check order exists
    const existing = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ? AND tenant_id = ?"
    )
      .bind(orderId, tenantId)
      .first<Order>();

    if (!existing) {
      throw new ApiError("Order not found", 404, "ORDER_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateOrderSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateOrderSchema.parse(rawBody);
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
    }> = [
      { key: "customer_name", column: "customer_name" },
      { key: "customer_email", column: "customer_email" },
      { key: "customer_phone", column: "customer_phone" },
      { key: "status", column: "status" },
      { key: "shipping_cost", column: "shipping_cost" },
      { key: "tax_amount", column: "tax_amount" },
      { key: "discount_amount", column: "discount_amount" },
      { key: "shipping_street", column: "shipping_street" },
      { key: "shipping_city", column: "shipping_city" },
      { key: "shipping_state", column: "shipping_state" },
      { key: "shipping_zip", column: "shipping_zip" },
      { key: "shipping_country", column: "shipping_country" },
      { key: "tracking_number", column: "tracking_number" },
      { key: "tracking_url", column: "tracking_url" },
      { key: "notes", column: "notes" },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        values.push(body[field.key] as string | number | null);
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(orderId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE orders SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated order
    const updated = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ?"
    )
      .bind(orderId)
      .first<Order>();

    return c.json({
      success: true,
      data: updated,
    });
  }
);

// =============================================================================
// FULFILL ORDER
// =============================================================================

/**
 * POST /api/v1/orders/:id/fulfill
 * Mark an entire order as fulfilled and update inventory
 */
orders.post(
  "/:id/fulfill",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const orderId = c.req.param("id");

    // Check order exists
    const order = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ? AND tenant_id = ?"
    )
      .bind(orderId, tenantId)
      .first<Order>();

    if (!order) {
      throw new ApiError("Order not found", 404, "ORDER_NOT_FOUND");
    }

    if (order.status === "fulfilled" || order.status === "shipped") {
      throw new ApiError(
        "Order is already fulfilled",
        400,
        "ORDER_ALREADY_FULFILLED"
      );
    }

    if (order.status === "cancelled" || order.status === "refunded") {
      throw new ApiError(
        "Cannot fulfill a cancelled or refunded order",
        400,
        "ORDER_CANNOT_FULFILL"
      );
    }

    // Parse and validate request body
    let body: z.infer<typeof fulfillOrderSchema>;
    try {
      const rawBody = await c.req.json();
      body = fulfillOrderSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Get all unfulfilled items
    const itemsResult = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE order_id = ? AND fulfillment_status != 'fulfilled'"
    )
      .bind(orderId)
      .all<OrderItem>();

    const items = itemsResult.results || [];

    if (items.length === 0) {
      throw new ApiError(
        "All items are already fulfilled",
        400,
        "ALL_ITEMS_FULFILLED"
      );
    }

    const now = new Date().toISOString();
    const fulfillmentErrors: string[] = [];

    // Fulfill each item and update inventory
    for (const item of items) {
      const remainingToFulfill = item.quantity - item.quantity_fulfilled;

      if (remainingToFulfill <= 0) continue;

      // Check inventory if finished_good_id is linked
      if (item.finished_good_id) {
        const fg = await c.env.DB.prepare(
          "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
        )
          .bind(item.finished_good_id, tenantId)
          .first<FinishedGood>();

        if (fg) {
          const validation = validateFulfillmentQuantity(
            fg.current_stock,
            remainingToFulfill
          );

          if (!validation.valid) {
            fulfillmentErrors.push(
              `Insufficient stock for ${item.sku}: need ${remainingToFulfill}, have ${fg.current_stock}`
            );
            continue;
          }

          // Deduct from inventory
          const newStock = fg.current_stock - remainingToFulfill;
          await c.env.DB.prepare(
            `UPDATE finished_goods
             SET current_stock = ?,
                 status = CASE
                   WHEN ? <= 0 AND quantity_needs_assembly <= 0 THEN 'out_of_stock'
                   WHEN ? <= low_stock_threshold THEN 'low_stock'
                   ELSE 'in_stock'
                 END,
                 updated_at = ?
             WHERE id = ?`
          )
            .bind(newStock, newStock, newStock, now, item.finished_good_id)
            .run();
        }
      }

      // Update item as fulfilled
      await c.env.DB.prepare(
        `UPDATE order_items
         SET quantity_fulfilled = quantity, fulfillment_status = 'fulfilled'
         WHERE id = ?`
      )
        .bind(item.id)
        .run();
    }

    // Check if there were any errors
    if (fulfillmentErrors.length > 0 && fulfillmentErrors.length === items.length) {
      throw new ApiError(
        "Could not fulfill any items: " + fulfillmentErrors.join("; "),
        400,
        "FULFILLMENT_FAILED"
      );
    }

    // Recalculate order status based on item fulfillment
    const updatedItemsResult = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    )
      .bind(orderId)
      .all<OrderItem>();

    const updatedItems = updatedItemsResult.results || [];
    const orderStatus = calculateOrderStatus(updatedItems);

    // Update order status and tracking info
    await c.env.DB.prepare(
      `UPDATE orders
       SET status = ?,
           tracking_number = COALESCE(?, tracking_number),
           tracking_url = COALESCE(?, tracking_url),
           shipped_at = CASE WHEN ? IN ('shipped', 'fulfilled') THEN ? ELSE shipped_at END,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        orderStatus,
        body.tracking_number || null,
        body.tracking_url || null,
        orderStatus,
        now,
        now,
        orderId
      )
      .run();

    // Fetch updated order with items
    const updatedOrder = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ?"
    )
      .bind(orderId)
      .first<Order>();

    return c.json({
      success: true,
      data: {
        ...updatedOrder,
        items: updatedItems,
        fulfillment_errors: fulfillmentErrors.length > 0 ? fulfillmentErrors : undefined,
      },
    });
  }
);

// =============================================================================
// FULFILL SINGLE ITEM
// =============================================================================

/**
 * POST /api/v1/orders/:id/items/:itemId/fulfill
 * Fulfill a single order item (partial fulfillment support)
 */
orders.post(
  "/:id/items/:itemId/fulfill",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const orderId = c.req.param("id");
    const itemId = c.req.param("itemId");

    // Check order exists
    const order = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ? AND tenant_id = ?"
    )
      .bind(orderId, tenantId)
      .first<Order>();

    if (!order) {
      throw new ApiError("Order not found", 404, "ORDER_NOT_FOUND");
    }

    // Check item exists
    const item = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE id = ? AND order_id = ?"
    )
      .bind(itemId, orderId)
      .first<OrderItem>();

    if (!item) {
      throw new ApiError("Order item not found", 404, "ORDER_ITEM_NOT_FOUND");
    }

    if (item.fulfillment_status === "fulfilled") {
      throw new ApiError(
        "Item is already fully fulfilled",
        400,
        "ITEM_ALREADY_FULFILLED"
      );
    }

    // Parse and validate request body
    let body: z.infer<typeof fulfillItemSchema>;
    try {
      const rawBody = await c.req.json();
      body = fulfillItemSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const remainingToFulfill = item.quantity - item.quantity_fulfilled;
    if (body.quantity > remainingToFulfill) {
      throw new ApiError(
        `Cannot fulfill ${body.quantity} items. Only ${remainingToFulfill} remaining to fulfill.`,
        400,
        "EXCESSIVE_FULFILLMENT"
      );
    }

    const now = new Date().toISOString();

    // Check inventory if finished_good_id is linked
    if (item.finished_good_id) {
      const fg = await c.env.DB.prepare(
        "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
      )
        .bind(item.finished_good_id, tenantId)
        .first<FinishedGood>();

      if (fg) {
        const validation = validateFulfillmentQuantity(
          fg.current_stock,
          body.quantity
        );

        if (!validation.valid) {
          throw new ApiError(
            `Insufficient stock: need ${body.quantity}, have ${fg.current_stock}`,
            400,
            "INSUFFICIENT_STOCK"
          );
        }

        // Deduct from inventory
        const newStock = fg.current_stock - body.quantity;
        await c.env.DB.prepare(
          `UPDATE finished_goods
           SET current_stock = ?,
               status = CASE
                 WHEN ? <= 0 AND quantity_needs_assembly <= 0 THEN 'out_of_stock'
                 WHEN ? <= low_stock_threshold THEN 'low_stock'
                 ELSE 'in_stock'
               END,
               updated_at = ?
           WHERE id = ?`
        )
          .bind(newStock, newStock, newStock, now, item.finished_good_id)
          .run();
      }
    }

    // Update item fulfillment
    const newFulfilledQty = item.quantity_fulfilled + body.quantity;
    const newItemStatus = calculateItemFulfillmentStatus(
      item.quantity,
      newFulfilledQty
    );

    await c.env.DB.prepare(
      `UPDATE order_items
       SET quantity_fulfilled = ?, fulfillment_status = ?
       WHERE id = ?`
    )
      .bind(newFulfilledQty, newItemStatus, itemId)
      .run();

    // Recalculate order status
    const allItemsResult = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    )
      .bind(orderId)
      .all<OrderItem>();

    // Update the item in the list for status calculation
    const allItems = (allItemsResult.results || []).map((i) =>
      i.id === itemId
        ? { ...i, quantity_fulfilled: newFulfilledQty, fulfillment_status: newItemStatus }
        : i
    );

    const orderStatus = calculateOrderStatus(allItems);

    await c.env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`
    )
      .bind(orderStatus, now, orderId)
      .run();

    // Fetch updated item
    const updatedItem = await c.env.DB.prepare(
      "SELECT * FROM order_items WHERE id = ?"
    )
      .bind(itemId)
      .first<OrderItem>();

    return c.json({
      success: true,
      data: {
        item: updatedItem,
        order_status: orderStatus,
      },
    });
  }
);

// =============================================================================
// CANCEL ORDER
// =============================================================================

/**
 * DELETE /api/v1/orders/:id
 * Cancel an order
 */
orders.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const orderId = c.req.param("id");

    // Check order exists
    const order = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE id = ? AND tenant_id = ?"
    )
      .bind(orderId, tenantId)
      .first<Order>();

    if (!order) {
      throw new ApiError("Order not found", 404, "ORDER_NOT_FOUND");
    }

    if (order.status === "fulfilled" || order.status === "shipped") {
      throw new ApiError(
        "Cannot cancel a fulfilled or shipped order",
        400,
        "ORDER_CANNOT_CANCEL"
      );
    }

    if (order.status === "cancelled") {
      throw new ApiError("Order is already cancelled", 400, "ORDER_ALREADY_CANCELLED");
    }

    const now = new Date().toISOString();

    // Update order status
    await c.env.DB.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`
    )
      .bind(now, orderId)
      .run();

    // Update all items to cancelled
    await c.env.DB.prepare(
      `UPDATE order_items SET fulfillment_status = 'cancelled' WHERE order_id = ?`
    )
      .bind(orderId)
      .run();

    return c.json({
      success: true,
      message: "Order cancelled successfully",
    });
  }
);

// =============================================================================
// ORDER STATISTICS
// =============================================================================

/**
 * GET /api/v1/orders/stats
 * Get order statistics and summaries
 */
orders.get("/stats", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Get order counts by status
  const statusStats = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM orders
     WHERE tenant_id = ?
     GROUP BY status`
  )
    .bind(tenantId)
    .all<{ status: string; count: number }>();

  const statusCounts: Record<string, number> = {};
  for (const row of statusStats.results || []) {
    statusCounts[row.status] = row.count;
  }

  // Get platform breakdown
  const platformStats = await c.env.DB.prepare(
    `SELECT platform, COUNT(*) as count
     FROM orders
     WHERE tenant_id = ?
     GROUP BY platform`
  )
    .bind(tenantId)
    .all<{ platform: string; count: number }>();

  const platformCounts: Record<string, number> = {};
  for (const row of platformStats.results || []) {
    platformCounts[row.platform] = row.count;
  }

  // Get revenue summary (last 30 days)
  const revenueStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total_orders,
       COALESCE(SUM(total_revenue), 0) as total_revenue,
       COALESCE(SUM(shipping_cost), 0) as total_shipping,
       COALESCE(SUM(tax_amount), 0) as total_tax,
       COALESCE(SUM(discount_amount), 0) as total_discount,
       COALESCE(AVG(total_revenue), 0) as avg_order_value
     FROM orders
     WHERE tenant_id = ?
       AND order_date >= datetime('now', '-30 days')
       AND status NOT IN ('cancelled', 'refunded')`
  )
    .bind(tenantId)
    .first<{
      total_orders: number;
      total_revenue: number;
      total_shipping: number;
      total_tax: number;
      total_discount: number;
      avg_order_value: number;
    }>();

  // Get pending fulfillment count
  const pendingResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count
     FROM orders
     WHERE tenant_id = ?
       AND status IN ('pending', 'processing', 'printed', 'assembled')`
  )
    .bind(tenantId)
    .first<{ count: number }>();

  const stats: OrderStats = {
    total_orders: (statusStats.results || []).reduce((sum, r) => sum + r.count, 0),
    by_status: statusCounts,
    by_platform: platformCounts,
    pending_fulfillment: pendingResult?.count || 0,
    last_30_days: {
      total_orders: revenueStats?.total_orders || 0,
      total_revenue: revenueStats?.total_revenue || 0,
      total_shipping: revenueStats?.total_shipping || 0,
      total_tax: revenueStats?.total_tax || 0,
      total_discount: revenueStats?.total_discount || 0,
      avg_order_value: Math.round(revenueStats?.avg_order_value || 0),
    },
  };

  return c.json({
    success: true,
    data: stats,
  });
});
