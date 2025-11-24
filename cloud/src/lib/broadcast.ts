/**
 * Broadcast Helper Library
 *
 * Helper functions for broadcasting messages to dashboard clients
 * via the DashboardBroadcast Durable Object.
 *
 * These functions are used by:
 * - Queue handlers (print-events, shopify-sync, notifications)
 * - API routes when immediate broadcast is needed
 */

import type { Env } from "../types/env";
import type {
  PrinterStatus,
  PrintJobStatus,
  OrderPlatform,
} from "../types";

// =============================================================================
// TYPES
// =============================================================================

interface BroadcastResult {
  success: boolean;
  clients_reached?: number;
  error?: string;
}

// =============================================================================
// BROADCAST FUNCTIONS
// =============================================================================

/**
 * Broadcast printer status update to dashboard clients
 *
 * @param env - Cloudflare Workers environment
 * @param tenantId - Tenant ID for routing to correct DO
 * @param printerId - Printer ID
 * @param status - Printer status
 * @param progressPercentage - Optional progress percentage (0-100)
 * @param remainingTimeSeconds - Optional remaining print time in seconds
 */
export async function broadcastPrinterStatus(
  env: Env,
  tenantId: string,
  printerId: string,
  status: PrinterStatus,
  progressPercentage?: number,
  remainingTimeSeconds?: number
): Promise<BroadcastResult> {
  return sendBroadcast(env, tenantId, {
    type: "printer_status",
    printer_id: printerId,
    status,
    progress_percentage: progressPercentage,
    remaining_time_seconds: remainingTimeSeconds,
  });
}

/**
 * Broadcast job update to dashboard clients
 *
 * @param env - Cloudflare Workers environment
 * @param tenantId - Tenant ID for routing to correct DO
 * @param jobId - Job ID
 * @param status - Job status
 * @param progressPercentage - Optional progress percentage (0-100)
 * @param printerId - Optional printer ID (for filtering by subscription)
 */
export async function broadcastJobUpdate(
  env: Env,
  tenantId: string,
  jobId: string,
  status: PrintJobStatus,
  progressPercentage?: number,
  printerId?: string
): Promise<BroadcastResult> {
  return sendBroadcast(env, tenantId, {
    type: "job_update",
    job_id: jobId,
    status,
    progress_percentage: progressPercentage,
    printer_id: printerId,
  });
}

/**
 * Broadcast hub status change to dashboard clients
 *
 * @param env - Cloudflare Workers environment
 * @param tenantId - Tenant ID for routing to correct DO
 * @param hubId - Hub ID
 * @param isOnline - Whether the hub is online
 */
export async function broadcastHubStatus(
  env: Env,
  tenantId: string,
  hubId: string,
  isOnline: boolean
): Promise<BroadcastResult> {
  return sendBroadcast(env, tenantId, {
    type: "hub_status",
    hub_id: hubId,
    is_online: isOnline,
  });
}

/**
 * Broadcast inventory alert to dashboard clients
 *
 * @param env - Cloudflare Workers environment
 * @param tenantId - Tenant ID for routing to correct DO
 * @param skuId - Product SKU ID
 * @param sku - SKU code
 * @param currentStock - Current stock level
 * @param threshold - Low stock threshold
 */
export async function broadcastInventoryAlert(
  env: Env,
  tenantId: string,
  skuId: string,
  sku: string,
  currentStock: number,
  threshold: number
): Promise<BroadcastResult> {
  return sendBroadcast(env, tenantId, {
    type: "inventory_alert",
    sku_id: skuId,
    sku,
    current_stock: currentStock,
    threshold,
  });
}

/**
 * Broadcast new order notification to dashboard clients
 *
 * @param env - Cloudflare Workers environment
 * @param tenantId - Tenant ID for routing to correct DO
 * @param orderId - Order ID
 * @param orderNumber - Order number
 * @param platform - Order platform (shopify, amazon, manual, etc.)
 * @param totalItems - Total number of items in the order
 */
export async function broadcastNewOrder(
  env: Env,
  tenantId: string,
  orderId: string,
  orderNumber: string,
  platform: OrderPlatform,
  totalItems: number
): Promise<BroadcastResult> {
  return sendBroadcast(env, tenantId, {
    type: "new_order",
    order_id: orderId,
    order_number: orderNumber,
    platform,
    total_items: totalItems,
  });
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Send a broadcast message to the DashboardBroadcast Durable Object
 */
async function sendBroadcast(
  env: Env,
  tenantId: string,
  message: Record<string, unknown>
): Promise<BroadcastResult> {
  try {
    // Get the DashboardBroadcast DO stub for this tenant
    const doId = env.DASHBOARD_BROADCASTS.idFromName(tenantId);
    const stub = env.DASHBOARD_BROADCASTS.get(doId);

    // Send broadcast request to DO
    const response = await stub.fetch("http://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Broadcast] Failed to broadcast: ${errorText}`);
      return { success: false, error: errorText };
    }

    const result = (await response.json()) as { success: boolean; clients_reached: number };
    return {
      success: result.success,
      clients_reached: result.clients_reached,
    };
  } catch (error) {
    console.error("[Broadcast] Error sending broadcast:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Broadcast multiple messages to the same tenant
 * More efficient than calling individual broadcast functions when you have multiple updates
 */
export async function broadcastBatch(
  env: Env,
  tenantId: string,
  messages: Array<Record<string, unknown>>
): Promise<BroadcastResult[]> {
  const results: BroadcastResult[] = [];

  for (const message of messages) {
    const result = await sendBroadcast(env, tenantId, message);
    results.push(result);
  }

  return results;
}
