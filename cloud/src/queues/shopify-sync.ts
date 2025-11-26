/**
 * Shopify Sync Queue Handler
 *
 * Handles background Shopify synchronization tasks including:
 * - Manual sync triggers
 * - Full order imports
 * - Fulfillment sync back to Shopify
 * - Inventory sync
 *
 * Phase 10: Orders & Shopify Integration
 */

import type { Env, ShopifySyncMessage } from "../types/env";
import { generateId } from "../lib/crypto";
import { decryptAES256GCM } from "../lib/crypto";
import {
  convertShopifyOrder,
  shouldSyncShopifyOrder,
  matchSku,
  type ShopifyOrder,
} from "../lib/orders";
import { sendToDeadLetter } from "../lib/dlq";

// =============================================================================
// TYPES
// =============================================================================

interface TenantIntegration {
  id: string;
  tenant_id: string;
  credentials_encrypted: string;
  is_enabled: number;
  sync_enabled: number;
}

interface ShopifyCredentials {
  shop_domain: string;
  api_key: string;
  api_secret: string;
  access_token: string;
}

interface SyncResult {
  success: boolean;
  orders_synced: number;
  orders_skipped: number;
  errors: string[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get Shopify credentials for a tenant
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
 * Fetch orders from Shopify API
 */
async function fetchShopifyOrders(
  credentials: ShopifyCredentials,
  options: {
    since_date?: string | null | undefined;
    status?: string;
    limit?: number;
    page_info?: string | undefined;
  } = {}
): Promise<{
  orders: ShopifyOrder[];
  hasNextPage: boolean;
  nextPageInfo?: string | undefined;
}> {
  const { shop_domain, access_token } = credentials;
  const limit = options.limit || 50;

  let url: string;

  if (options.page_info) {
    // Use cursor-based pagination
    url = `https://${shop_domain}/admin/api/2024-01/orders.json?limit=${limit}&page_info=${options.page_info}`;
  } else {
    // Initial request with filters
    const params = new URLSearchParams({
      limit: String(limit),
      status: options.status || "any",
    });

    if (options.since_date) {
      params.set("created_at_min", options.since_date);
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      params.set("created_at_min", thirtyDaysAgo.toISOString());
    }

    url = `https://${shop_domain}/admin/api/2024-01/orders.json?${params.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": access_token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as { orders: ShopifyOrder[] };

  // Check for pagination
  const linkHeader = response.headers.get("Link");
  let hasNextPage = false;
  let nextPageInfo: string | undefined;

  if (linkHeader) {
    const nextMatch = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      hasNextPage = true;
      nextPageInfo = nextMatch[1];
    }
  }

  return {
    orders: data.orders || [],
    hasNextPage,
    nextPageInfo,
  };
}

/**
 * Sync a single Shopify order to the local database
 */
async function syncShopifyOrder(
  db: D1Database,
  tenantId: string,
  shopifyOrder: ShopifyOrder
): Promise<{ success: boolean; orderId?: string; skipped?: boolean; error?: string }> {
  const now = new Date().toISOString();

  // Check if we should sync this order
  if (!shouldSyncShopifyOrder(shopifyOrder)) {
    return { success: true, skipped: true };
  }

  // Check if already synced
  const existingSync = await db
    .prepare(
      "SELECT local_order_id, sync_status FROM shopify_orders_sync WHERE tenant_id = ? AND shopify_order_id = ?"
    )
    .bind(tenantId, String(shopifyOrder.id))
    .first<{ local_order_id: string | null; sync_status: string }>();

  if (existingSync?.local_order_id && existingSync.sync_status === "synced") {
    // Already synced, skip
    return { success: true, skipped: true };
  }

  try {
    // Convert order data
    const { order, items } = convertShopifyOrder(shopifyOrder, tenantId);

    // Create order
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
          null,
          now
        )
        .run();
    }

    // Record sync
    if (existingSync) {
      // Update existing sync record
      await db
        .prepare(
          `UPDATE shopify_orders_sync
           SET local_order_id = ?, sync_status = 'synced', sync_error = NULL, updated_at = ?
           WHERE tenant_id = ? AND shopify_order_id = ?`
        )
        .bind(orderId, now, tenantId, String(shopifyOrder.id))
        .run();
    } else {
      // Create new sync record
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
    }

    return { success: true, orderId };
  } catch (error) {
    console.error(`Error syncing Shopify order ${shopifyOrder.id}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Run full order sync for a tenant
 */
async function runOrderSync(
  env: Env,
  tenantId: string,
  options: {
    since_date?: string | null;
    full_sync?: boolean;
  }
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    orders_synced: 0,
    orders_skipped: 0,
    errors: [],
  };

  // Get credentials
  const credResult = await getShopifyCredentials(
    env.DB,
    tenantId,
    env.ENCRYPTION_KEY
  );

  if (!credResult) {
    result.success = false;
    result.errors.push("Shopify credentials not found or invalid");
    return result;
  }

  const { integration, credentials } = credResult;

  try {
    let hasMore = true;
    let pageInfo: string | undefined;

    while (hasMore) {
      // Fetch orders from Shopify
      const fetchResult = await fetchShopifyOrders(credentials, {
        since_date: options.full_sync ? null : options.since_date,
        page_info: pageInfo,
        limit: 50,
      });

      // Process each order
      for (const shopifyOrder of fetchResult.orders) {
        const syncResult = await syncShopifyOrder(env.DB, tenantId, shopifyOrder);

        if (syncResult.skipped) {
          result.orders_skipped++;
        } else if (syncResult.success) {
          result.orders_synced++;
        } else {
          result.errors.push(
            `Order ${shopifyOrder.name}: ${syncResult.error || "Unknown error"}`
          );
        }
      }

      // Check for more pages
      hasMore = fetchResult.hasNextPage;
      pageInfo = fetchResult.nextPageInfo;

      // Rate limiting - wait 500ms between pages
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Update last sync time
    await env.DB.prepare(
      `UPDATE tenant_integrations
       SET last_sync_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`
    )
      .bind(new Date().toISOString(), new Date().toISOString(), integration.id)
      .run();

    if (result.errors.length > 0) {
      result.success = false;
    }
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : "Unknown error");

    // Log error to integration record
    await env.DB.prepare(
      `UPDATE tenant_integrations SET last_error = ?, updated_at = ? WHERE id = ?`
    )
      .bind(
        result.errors.join("; "),
        new Date().toISOString(),
        integration.id
      )
      .run();
  }

  return result;
}

/**
 * Sync fulfillment back to Shopify
 */
async function syncFulfillmentToShopify(
  env: Env,
  tenantId: string,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  // Get Shopify credentials
  const credResult = await getShopifyCredentials(
    env.DB,
    tenantId,
    env.ENCRYPTION_KEY
  );

  if (!credResult) {
    return { success: false, error: "Shopify credentials not found" };
  }

  const { credentials } = credResult;

  // Get the sync record to find Shopify order ID
  const syncRecord = await env.DB.prepare(
    "SELECT shopify_order_id FROM shopify_orders_sync WHERE local_order_id = ?"
  )
    .bind(orderId)
    .first<{ shopify_order_id: string }>();

  if (!syncRecord) {
    return { success: false, error: "Order not linked to Shopify" };
  }

  // Get order and items
  const order = await env.DB.prepare(
    "SELECT tracking_number FROM orders WHERE id = ?"
  )
    .bind(orderId)
    .first<{ tracking_number: string | null }>();

  const items = await env.DB.prepare(
    "SELECT * FROM order_items WHERE order_id = ? AND fulfillment_status = 'fulfilled'"
  )
    .bind(orderId)
    .all<{ sku: string; quantity: number; quantity_fulfilled: number }>();

  if (!items.results || items.results.length === 0) {
    return { success: false, error: "No fulfilled items to sync" };
  }

  try {
    // Create fulfillment in Shopify
    // Note: This requires mapping our items back to Shopify line item IDs
    // For now, we'll create a simple fulfillment
    const fulfillmentUrl = `https://${credentials.shop_domain}/admin/api/2024-01/orders/${syncRecord.shopify_order_id}/fulfillments.json`;

    const fulfillmentData = {
      fulfillment: {
        notify_customer: true,
        ...(order?.tracking_number && { tracking_number: order.tracking_number }),
      },
    };

    const response = await fetch(fulfillmentUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": credentials.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fulfillmentData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Shopify API error: ${response.status} - ${errorText}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// ORDER UPDATE HANDLER
// =============================================================================

/**
 * Handle order updates from Shopify
 */
async function handleOrderUpdate(
  env: Env,
  tenantId: string,
  payload: {
    shopify_order_id?: string;
    status?: string;
    cancelled?: boolean;
    notes?: string;
    tags?: string[];
  }
): Promise<void> {
  const { shopify_order_id, status, cancelled, notes, tags } = payload;

  if (!shopify_order_id) {
    console.log(`[ShopifySync] No Shopify order ID provided for update`);
    return;
  }

  console.log(`[ShopifySync] Processing order update for Shopify order ${shopify_order_id}`);

  // Find the local order by Shopify order ID
  const syncRecord = await env.DB.prepare(
    `SELECT order_id FROM shopify_orders_sync
     WHERE tenant_id = ? AND shopify_order_id = ?`
  )
    .bind(tenantId, shopify_order_id)
    .first<{ order_id: string }>();

  if (!syncRecord) {
    console.log(`[ShopifySync] No local order found for Shopify order ${shopify_order_id}`);
    return;
  }

  const orderId = syncRecord.order_id;

  // Build update query dynamically
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (cancelled) {
    updates.push("status = ?");
    params.push("cancelled");
  } else if (status) {
    updates.push("status = ?");
    params.push(status);
  }

  if (notes !== undefined) {
    updates.push("notes = ?");
    params.push(notes);
  }

  if (tags !== undefined) {
    updates.push("tags = ?");
    params.push(JSON.stringify(tags));
  }

  if (updates.length === 0) {
    console.log(`[ShopifySync] No updates to apply for order ${orderId}`);
    return;
  }

  // Add updated_at timestamp
  updates.push("updated_at = ?");
  params.push(new Date().toISOString());

  // Add where clause params
  params.push(orderId);
  params.push(tenantId);

  // Execute update
  await env.DB.prepare(
    `UPDATE orders SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
  )
    .bind(...params)
    .run();

  // Update sync record timestamp
  await env.DB.prepare(
    `UPDATE shopify_orders_sync SET last_sync_at = ? WHERE order_id = ?`
  )
    .bind(new Date().toISOString(), orderId)
    .run();

  console.log(`[ShopifySync] Updated order ${orderId} from Shopify order ${shopify_order_id}`);
}

// =============================================================================
// QUEUE HANDLER
// =============================================================================

/**
 * Handle messages from the shopify-sync queue
 */
export async function handleShopifySyncQueue(
  batch: MessageBatch<ShopifySyncMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { type, tenantId, payload } = message.body;

    console.log(`[ShopifySync] Processing ${type} for tenant ${tenantId}`);

    try {
      switch (type) {
        case "order_created": {
          // This can be triggered by manual sync
          if ((payload as Record<string, unknown>).manual_sync) {
            const options = payload as {
              since_date?: string | null;
              full_sync?: boolean;
            };

            const result = await runOrderSync(env, tenantId, options);

            console.log(
              `[ShopifySync] Manual sync completed for tenant ${tenantId}: ` +
                `synced=${result.orders_synced}, skipped=${result.orders_skipped}, errors=${result.errors.length}`
            );
          }
          break;
        }

        case "order_updated": {
          // Handle order update sync
          const updatePayload = payload as {
            shopify_order_id?: string;
            status?: string;
            cancelled?: boolean;
            notes?: string;
            tags?: string[];
          };

          if (updatePayload.shopify_order_id) {
            await handleOrderUpdate(env, tenantId, updatePayload);
          }
          break;
        }

        case "inventory_sync": {
          // Handle fulfillment sync back to Shopify
          const { order_id } = payload as { order_id?: string };

          if (order_id) {
            const result = await syncFulfillmentToShopify(env, tenantId, order_id);

            if (result.success) {
              console.log(`[ShopifySync] Synced fulfillment for order ${order_id}`);
            } else {
              console.error(
                `[ShopifySync] Failed to sync fulfillment for order ${order_id}: ${result.error}`
              );
            }
          }
          break;
        }

        default:
          console.warn(`[ShopifySync] Unknown message type: ${type}`);
      }

      // Acknowledge the message
      message.ack();
    } catch (error) {
      console.error(`[ShopifySync] Error processing message:`, error);

      // Retry logic - retry up to 3 times
      if (message.attempts < 3) {
        message.retry();
      } else {
        // Send to dead letter queue after max retries
        const errorObj = error instanceof Error ? error : new Error(String(error));
        await sendToDeadLetter(
          env,
          "shopify-sync",
          message.body,
          errorObj,
          message.attempts,
          tenantId
        );
        message.ack();
      }
    }
  }
}

// Export types for use in index.ts
export type { ShopifySyncMessage };
