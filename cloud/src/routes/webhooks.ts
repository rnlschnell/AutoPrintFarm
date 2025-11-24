/**
 * Webhooks Routes - External Platform Webhook Handlers
 *
 * Handles incoming webhooks from external platforms like Shopify.
 * These endpoints are NOT tenant-scoped and require webhook signature verification.
 *
 * Phase 10: Orders & Shopify Integration
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { generateId } from "../lib/crypto";
import {
  validateShopifyWebhook,
  convertShopifyOrder,
  shouldSyncShopifyOrder,
  matchSku,
  type ShopifyOrder,
} from "../lib/orders";
import { broadcastNewOrder } from "../lib/broadcast";

export const webhooks = new Hono<HonoEnv>();

// =============================================================================
// TYPES
// =============================================================================

interface TenantIntegration {
  id: string;
  tenant_id: string;
  platform: string;
  credentials_encrypted: string;
  is_enabled: number;
  sync_enabled: number;
  webhook_enabled: number;
}

interface ShopifyCredentials {
  shop_domain: string;
  api_key: string;
  api_secret: string;
  access_token: string;
  webhook_secret?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Decrypt and parse Shopify credentials
 */
async function getShopifyCredentials(
  db: D1Database,
  tenantId: string,
  encryptionKey: string
): Promise<{ integration: TenantIntegration; credentials: ShopifyCredentials } | null> {
  const integration = await db
    .prepare(
      "SELECT * FROM tenant_integrations WHERE tenant_id = ? AND platform = 'shopify' AND is_enabled = 1"
    )
    .bind(tenantId)
    .first<TenantIntegration>();

  if (!integration) {
    return null;
  }

  try {
    // Import decrypt function dynamically to avoid circular deps
    const { decryptAES256GCM } = await import("../lib/crypto");
    const decrypted = await decryptAES256GCM(
      integration.credentials_encrypted,
      encryptionKey
    );
    const credentials = JSON.parse(decrypted) as ShopifyCredentials;
    return { integration, credentials };
  } catch {
    return null;
  }
}

/**
 * Log webhook error
 */
async function logWebhookError(
  db: D1Database,
  _tenantId: string, // Reserved for future use with tenant-specific error logging
  integrationId: string,
  error: string
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE tenant_integrations SET last_error = ?, updated_at = ? WHERE id = ?`
      )
      .bind(error, new Date().toISOString(), integrationId)
      .run();
  } catch {
    console.error("Failed to log webhook error:", error);
  }
}

/**
 * Create or update order from Shopify data
 */
async function upsertShopifyOrder(
  db: D1Database,
  tenantId: string,
  shopifyOrder: ShopifyOrder
): Promise<{ orderId: string; created: boolean }> {
  const now = new Date().toISOString();

  // Check if we've already synced this order
  const existingSync = await db
    .prepare(
      "SELECT local_order_id FROM shopify_orders_sync WHERE tenant_id = ? AND shopify_order_id = ?"
    )
    .bind(tenantId, String(shopifyOrder.id))
    .first<{ local_order_id: string | null }>();

  if (existingSync?.local_order_id) {
    // Order already exists, return it
    return { orderId: existingSync.local_order_id, created: false };
  }

  // Convert Shopify order to our format
  const { order, items } = convertShopifyOrder(shopifyOrder, tenantId);

  // Create new order
  const orderId = generateId();

  await db
    .prepare(
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
      order.order_number,
      order.platform,
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      order.order_date,
      order.status,
      order.total_revenue,
      order.shipping_cost,
      order.tax_amount,
      order.discount_amount,
      order.shipping_street,
      order.shipping_city,
      order.shipping_state,
      order.shipping_zip,
      order.shipping_country,
      order.external_id,
      order.external_data,
      order.notes,
      now,
      now
    )
    .run();

  // Get local SKUs for matching
  const localSkusResult = await db
    .prepare(
      `SELECT ps.id, ps.sku, fg.id as finished_good_id
       FROM product_skus ps
       LEFT JOIN finished_goods fg ON fg.product_sku_id = ps.id AND fg.is_active = 1
       WHERE ps.tenant_id = ?`
    )
    .bind(tenantId)
    .all<{ id: string; sku: string; finished_good_id: string | null }>();

  const localSkus = (localSkusResult.results || []).map((r) => ({
    id: r.id,
    sku: r.sku,
    finished_good_id: r.finished_good_id || undefined,
  }));

  // Create order items
  for (const item of items) {
    const itemId = generateId();

    // Try to match SKU
    const match = matchSku(item.sku || "", localSkus);

    await db
      .prepare(
        `INSERT INTO order_items (
          id, order_id, product_sku_id, finished_good_id,
          sku, product_name, quantity, unit_price, total_price,
          quantity_fulfilled, fulfillment_status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        itemId,
        orderId,
        match.product_sku_id || null,
        match.finished_good_id || null,
        item.sku,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.total_price,
        item.quantity_fulfilled || 0,
        item.fulfillment_status || "pending",
        match.confidence !== "exact" && match.matched
          ? `SKU matched with ${match.confidence} confidence`
          : null,
        now
      )
      .run();
  }

  // Record the sync
  await db
    .prepare(
      `INSERT INTO shopify_orders_sync (
        id, tenant_id, shopify_order_id, shopify_order_number,
        local_order_id, sync_status, shopify_created_at, synced_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      generateId(),
      tenantId,
      String(shopifyOrder.id),
      shopifyOrder.name,
      orderId,
      "synced",
      shopifyOrder.created_at,
      now,
      now
    )
    .run();

  return { orderId, created: true };
}

/**
 * Update existing order from Shopify data
 */
async function updateOrderFromShopify(
  db: D1Database,
  tenantId: string,
  orderId: string,
  shopifyOrder: ShopifyOrder
): Promise<void> {
  const now = new Date().toISOString();
  const { order } = convertShopifyOrder(shopifyOrder, tenantId);

  await db
    .prepare(
      `UPDATE orders
       SET status = ?,
           total_revenue = ?,
           shipping_cost = ?,
           tax_amount = ?,
           discount_amount = ?,
           external_data = ?,
           notes = COALESCE(?, notes),
           updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .bind(
      order.status,
      order.total_revenue,
      order.shipping_cost,
      order.tax_amount,
      order.discount_amount,
      order.external_data,
      order.notes,
      now,
      orderId,
      tenantId
    )
    .run();

  // Update sync record
  await db
    .prepare(
      `UPDATE shopify_orders_sync SET updated_at = ? WHERE local_order_id = ?`
    )
    .bind(now, orderId)
    .run();
}

// =============================================================================
// SHOPIFY WEBHOOKS
// =============================================================================

/**
 * POST /webhooks/shopify/:tenantId/orders/create
 * Handle new order webhook from Shopify
 */
webhooks.post("/shopify/:tenantId/orders/create", async (c) => {
  const tenantId = c.req.param("tenantId");

  // Get raw body for HMAC verification
  const rawBody = await c.req.text();

  // Get HMAC header
  const hmacHeader = c.req.header("X-Shopify-Hmac-SHA256");
  if (!hmacHeader) {
    console.warn(`[Webhook] Missing HMAC header for tenant ${tenantId}`);
    return c.json({ error: "Missing HMAC header" }, 401);
  }

  // Get Shopify credentials
  const result = await getShopifyCredentials(
    c.env.DB,
    tenantId,
    c.env.ENCRYPTION_KEY
  );

  if (!result) {
    console.warn(`[Webhook] Shopify not configured for tenant ${tenantId}`);
    return c.json({ error: "Shopify not configured" }, 404);
  }

  const { integration, credentials } = result;

  // Verify webhook signature
  if (credentials.webhook_secret) {
    const isValid = await validateShopifyWebhook(
      rawBody,
      hmacHeader,
      credentials.webhook_secret
    );

    if (!isValid) {
      console.warn(`[Webhook] Invalid signature for tenant ${tenantId}`);
      await logWebhookError(
        c.env.DB,
        tenantId,
        integration.id,
        "Invalid webhook signature"
      );
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Parse order data
  let shopifyOrder: ShopifyOrder;
  try {
    shopifyOrder = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    console.error(`[Webhook] Invalid JSON for tenant ${tenantId}`);
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Check if we should sync this order
  if (!shouldSyncShopifyOrder(shopifyOrder)) {
    console.log(
      `[Webhook] Skipping order ${shopifyOrder.name} for tenant ${tenantId} (filtered)`
    );
    return c.json({ success: true, skipped: true });
  }

  try {
    // Create the order
    const { orderId, created } = await upsertShopifyOrder(
      c.env.DB,
      tenantId,
      shopifyOrder
    );

    console.log(
      `[Webhook] ${created ? "Created" : "Found existing"} order ${orderId} for Shopify order ${shopifyOrder.name}`
    );

    // Queue notification and broadcast to dashboard if this is a new order
    if (created) {
      // Queue push notification
      await c.env.NOTIFICATIONS.send({
        type: "push",
        tenantId,
        payload: {
          event: "new_order",
          order_id: orderId,
          order_number: shopifyOrder.name,
          platform: "shopify",
          total: shopifyOrder.total_price,
          item_count: shopifyOrder.line_items.length,
        },
        timestamp: Date.now(),
      });

      // Broadcast to dashboard via WebSocket
      await broadcastNewOrder(
        c.env,
        tenantId,
        orderId,
        shopifyOrder.name,
        "shopify",
        shopifyOrder.line_items.length
      );
    }

    return c.json({ success: true, order_id: orderId, created });
  } catch (error) {
    console.error(`[Webhook] Error processing order:`, error);
    await logWebhookError(
      c.env.DB,
      tenantId,
      integration.id,
      `Failed to process order: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json({ error: "Failed to process order" }, 500);
  }
});

/**
 * POST /webhooks/shopify/:tenantId/orders/updated
 * Handle order updated webhook from Shopify
 */
webhooks.post("/shopify/:tenantId/orders/updated", async (c) => {
  const tenantId = c.req.param("tenantId");
  const rawBody = await c.req.text();
  const hmacHeader = c.req.header("X-Shopify-Hmac-SHA256");

  if (!hmacHeader) {
    return c.json({ error: "Missing HMAC header" }, 401);
  }

  const result = await getShopifyCredentials(
    c.env.DB,
    tenantId,
    c.env.ENCRYPTION_KEY
  );

  if (!result) {
    return c.json({ error: "Shopify not configured" }, 404);
  }

  const { integration, credentials } = result;

  // Verify signature
  if (credentials.webhook_secret) {
    const isValid = await validateShopifyWebhook(
      rawBody,
      hmacHeader,
      credentials.webhook_secret
    );

    if (!isValid) {
      await logWebhookError(c.env.DB, tenantId, integration.id, "Invalid webhook signature");
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let shopifyOrder: ShopifyOrder;
  try {
    shopifyOrder = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  try {
    // Check if we have this order
    const existingSync = await c.env.DB.prepare(
      "SELECT local_order_id FROM shopify_orders_sync WHERE tenant_id = ? AND shopify_order_id = ?"
    )
      .bind(tenantId, String(shopifyOrder.id))
      .first<{ local_order_id: string | null }>();

    if (existingSync?.local_order_id) {
      // Update existing order
      await updateOrderFromShopify(
        c.env.DB,
        tenantId,
        existingSync.local_order_id,
        shopifyOrder
      );
      console.log(`[Webhook] Updated order ${existingSync.local_order_id} from Shopify`);
      return c.json({ success: true, order_id: existingSync.local_order_id, updated: true });
    } else {
      // Order doesn't exist, create it
      const { orderId, created } = await upsertShopifyOrder(
        c.env.DB,
        tenantId,
        shopifyOrder
      );
      console.log(`[Webhook] Created order ${orderId} from update webhook`);
      return c.json({ success: true, order_id: orderId, created });
    }
  } catch (error) {
    console.error(`[Webhook] Error updating order:`, error);
    await logWebhookError(
      c.env.DB,
      tenantId,
      integration.id,
      `Failed to update order: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json({ error: "Failed to update order" }, 500);
  }
});

/**
 * POST /webhooks/shopify/:tenantId/orders/cancelled
 * Handle order cancelled webhook from Shopify
 */
webhooks.post("/shopify/:tenantId/orders/cancelled", async (c) => {
  const tenantId = c.req.param("tenantId");
  const rawBody = await c.req.text();
  const hmacHeader = c.req.header("X-Shopify-Hmac-SHA256");

  if (!hmacHeader) {
    return c.json({ error: "Missing HMAC header" }, 401);
  }

  const result = await getShopifyCredentials(
    c.env.DB,
    tenantId,
    c.env.ENCRYPTION_KEY
  );

  if (!result) {
    return c.json({ error: "Shopify not configured" }, 404);
  }

  const { integration, credentials } = result;

  // Verify signature
  if (credentials.webhook_secret) {
    const isValid = await validateShopifyWebhook(
      rawBody,
      hmacHeader,
      credentials.webhook_secret
    );

    if (!isValid) {
      await logWebhookError(c.env.DB, tenantId, integration.id, "Invalid webhook signature");
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let shopifyOrder: ShopifyOrder;
  try {
    shopifyOrder = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const now = new Date().toISOString();

  try {
    // Find the local order
    const existingSync = await c.env.DB.prepare(
      "SELECT local_order_id FROM shopify_orders_sync WHERE tenant_id = ? AND shopify_order_id = ?"
    )
      .bind(tenantId, String(shopifyOrder.id))
      .first<{ local_order_id: string | null }>();

    if (existingSync?.local_order_id) {
      // Cancel the order
      await c.env.DB.prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`
      )
        .bind(now, existingSync.local_order_id)
        .run();

      // Cancel all items
      await c.env.DB.prepare(
        `UPDATE order_items SET fulfillment_status = 'cancelled' WHERE order_id = ?`
      )
        .bind(existingSync.local_order_id)
        .run();

      console.log(`[Webhook] Cancelled order ${existingSync.local_order_id}`);
      return c.json({ success: true, order_id: existingSync.local_order_id, cancelled: true });
    } else {
      // Order doesn't exist locally, just log and return success
      console.log(`[Webhook] Received cancel for unknown order ${shopifyOrder.id}`);
      return c.json({ success: true, skipped: true });
    }
  } catch (error) {
    console.error(`[Webhook] Error cancelling order:`, error);
    await logWebhookError(
      c.env.DB,
      tenantId,
      integration.id,
      `Failed to cancel order: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return c.json({ error: "Failed to cancel order" }, 500);
  }
});

// =============================================================================
// HEALTH CHECK FOR WEBHOOKS
// =============================================================================

/**
 * GET /webhooks/health
 * Health check endpoint for webhook handlers
 */
webhooks.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "webhooks",
    timestamp: new Date().toISOString(),
  });
});
