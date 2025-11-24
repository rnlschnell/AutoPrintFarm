/**
 * Orders Helper Library
 *
 * Helper functions for order management operations including
 * fulfillment validation, status calculations, and order number generation.
 *
 * Phase 10: Orders & Shopify Integration
 */

import type {
  OrderStatus,
  FulfillmentStatus,
  OrderPlatform,
  OrderItem,
} from "../types";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Order statistics summary
 */
export interface OrderStats {
  total_orders: number;
  by_status: Record<string, number>;
  by_platform: Record<string, number>;
  pending_fulfillment: number;
  last_30_days: {
    total_orders: number;
    total_revenue: number;
    total_shipping: number;
    total_tax: number;
    total_discount: number;
    avg_order_value: number;
  };
}

/**
 * Shopify order data structure (simplified)
 */
export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string; // e.g., "#1001"
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  currency: string;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  } | null;
  billing_address: ShopifyAddress | null;
  shipping_address: ShopifyAddress | null;
  line_items: ShopifyLineItem[];
  shipping_lines: Array<{
    id: number;
    title: string;
    price: string;
    code: string;
  }>;
  note: string | null;
  tags: string;
}

export interface ShopifyAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string | null;
  company: string | null;
}

export interface ShopifyLineItem {
  id: number;
  product_id: number;
  variant_id: number;
  sku: string;
  title: string;
  name: string;
  quantity: number;
  price: string;
  fulfillable_quantity: number;
  fulfillment_status: string | null;
}

// =============================================================================
// FULFILLMENT VALIDATION
// =============================================================================

/**
 * Validate that there is enough stock to fulfill a quantity
 */
export function validateFulfillmentQuantity(
  currentStock: number,
  quantityNeeded: number
): { valid: boolean; message?: string } {
  if (currentStock < quantityNeeded) {
    return {
      valid: false,
      message: `Insufficient stock. Available: ${currentStock}, needed: ${quantityNeeded}`,
    };
  }

  return { valid: true };
}

/**
 * Check if an order can be cancelled
 */
export function canCancelOrder(status: OrderStatus): boolean {
  return !["fulfilled", "shipped", "cancelled", "refunded"].includes(status);
}

/**
 * Check if an order can be fulfilled
 */
export function canFulfillOrder(status: OrderStatus): boolean {
  return !["fulfilled", "shipped", "cancelled", "refunded"].includes(status);
}

// =============================================================================
// STATUS CALCULATIONS
// =============================================================================

/**
 * Calculate the overall order status based on item fulfillment states
 */
export function calculateOrderStatus(items: OrderItem[]): OrderStatus {
  if (items.length === 0) {
    return "pending";
  }

  const allFulfilled = items.every(
    (item) => item.fulfillment_status === "fulfilled"
  );
  const allCancelled = items.every(
    (item) => item.fulfillment_status === "cancelled"
  );
  const anyFulfilled = items.some(
    (item) =>
      item.fulfillment_status === "fulfilled" ||
      item.fulfillment_status === "partial"
  );
  const anyPartial = items.some(
    (item) => item.fulfillment_status === "partial"
  );

  if (allFulfilled) {
    return "fulfilled";
  }

  if (allCancelled) {
    return "cancelled";
  }

  if (anyPartial || anyFulfilled) {
    return "processing";
  }

  return "pending";
}

/**
 * Calculate item fulfillment status based on quantities
 */
export function calculateItemFulfillmentStatus(
  quantity: number,
  quantityFulfilled: number
): FulfillmentStatus {
  if (quantityFulfilled >= quantity) {
    return "fulfilled";
  }

  if (quantityFulfilled > 0) {
    return "partial";
  }

  return "pending";
}

/**
 * Map Shopify fulfillment status to our status
 */
export function mapShopifyFulfillmentStatus(
  shopifyStatus: string | null,
  cancelled: boolean
): OrderStatus {
  if (cancelled) {
    return "cancelled";
  }

  switch (shopifyStatus) {
    case "fulfilled":
      return "fulfilled";
    case "partial":
      return "processing";
    case "unfulfilled":
    case null:
    default:
      return "pending";
  }
}

// =============================================================================
// ORDER NUMBER GENERATION
// =============================================================================

/**
 * Generate a unique order number for manual orders
 * Format: PF-YYYYMMDD-XXXX (e.g., PF-20250123-A7B3)
 */
export function generateOrderNumber(platform: OrderPlatform = "manual"): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");

  // Generate random 4-character alphanumeric suffix
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const prefix = platform === "manual" ? "MAN" : "PF";
  return `${prefix}-${dateStr}-${suffix}`;
}

// =============================================================================
// SHOPIFY DATA CONVERSION
// =============================================================================

/**
 * Convert a Shopify order to our order format
 */
export function convertShopifyOrder(
  shopifyOrder: ShopifyOrder,
  tenantId: string
): {
  order: Partial<import("../types").Order>;
  items: Array<Partial<import("../types").OrderItem>>;
} {
  const shippingAddress = shopifyOrder.shipping_address;
  const customer = shopifyOrder.customer;

  // Calculate shipping cost from shipping_lines
  const shippingCost = shopifyOrder.shipping_lines.reduce(
    (sum, line) => sum + Math.round(parseFloat(line.price) * 100),
    0
  );

  const order: Partial<import("../types").Order> = {
    tenant_id: tenantId,
    order_number: shopifyOrder.name, // e.g., "#1001"
    platform: "shopify",
    customer_name: customer
      ? `${customer.first_name} ${customer.last_name}`.trim()
      : "Unknown Customer",
    customer_email: shopifyOrder.email || customer?.email || null,
    customer_phone: shopifyOrder.phone || customer?.phone || null,
    order_date: shopifyOrder.created_at,
    status: mapShopifyFulfillmentStatus(
      shopifyOrder.fulfillment_status,
      !!shopifyOrder.cancelled_at
    ),
    total_revenue: Math.round(parseFloat(shopifyOrder.total_price) * 100),
    shipping_cost: shippingCost,
    tax_amount: Math.round(parseFloat(shopifyOrder.total_tax) * 100),
    discount_amount: Math.round(parseFloat(shopifyOrder.total_discounts) * 100),
    shipping_street: shippingAddress
      ? [shippingAddress.address1, shippingAddress.address2]
          .filter(Boolean)
          .join(", ")
      : null,
    shipping_city: shippingAddress?.city || null,
    shipping_state: shippingAddress?.province || null,
    shipping_zip: shippingAddress?.zip || null,
    shipping_country: shippingAddress?.country || "USA",
    external_id: String(shopifyOrder.id),
    external_data: JSON.stringify({
      order_number: shopifyOrder.order_number,
      financial_status: shopifyOrder.financial_status,
      currency: shopifyOrder.currency,
      tags: shopifyOrder.tags,
    }),
    notes: shopifyOrder.note || null,
  };

  const items = shopifyOrder.line_items.map((lineItem) => ({
    sku: lineItem.sku || `SHOP-${lineItem.variant_id}`,
    product_name: lineItem.name || lineItem.title,
    quantity: lineItem.quantity,
    unit_price: Math.round(parseFloat(lineItem.price) * 100),
    total_price: Math.round(parseFloat(lineItem.price) * 100) * lineItem.quantity,
    quantity_fulfilled:
      lineItem.quantity - lineItem.fulfillable_quantity,
    fulfillment_status: calculateItemFulfillmentStatus(
      lineItem.quantity,
      lineItem.quantity - lineItem.fulfillable_quantity
    ),
  }));

  return { order, items };
}

/**
 * Create Shopify fulfillment payload
 */
export function createShopifyFulfillmentPayload(
  _orderId: string,
  lineItems: Array<{ id: number; quantity: number }>,
  trackingNumber?: string,
  trackingCompany?: string
): {
  fulfillment: {
    line_items: Array<{ id: number; quantity: number }>;
    tracking_number?: string;
    tracking_company?: string;
    notify_customer: boolean;
  };
} {
  return {
    fulfillment: {
      line_items: lineItems,
      ...(trackingNumber && { tracking_number: trackingNumber }),
      ...(trackingCompany && { tracking_company: trackingCompany }),
      notify_customer: true,
    },
  };
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate Shopify webhook HMAC signature
 */
export async function validateShopifyWebhook(
  body: string,
  hmacHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body)
    );

    const computedHmac = btoa(
      String.fromCharCode(...new Uint8Array(signature))
    );

    return computedHmac === hmacHeader;
  } catch {
    return false;
  }
}

/**
 * Check if a Shopify order should be synced
 * (filters out test orders, cancelled orders older than 30 days, etc.)
 */
export function shouldSyncShopifyOrder(order: ShopifyOrder): boolean {
  // Skip test orders (orders with specific tags)
  if (order.tags.toLowerCase().includes("test")) {
    return false;
  }

  // Skip orders cancelled more than 30 days ago
  if (order.cancelled_at) {
    const cancelledDate = new Date(order.cancelled_at);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (cancelledDate < thirtyDaysAgo) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// SKU MATCHING
// =============================================================================

/**
 * Attempt to match a Shopify SKU to a local product SKU
 */
export interface SkuMatchResult {
  matched: boolean;
  product_sku_id?: string | undefined;
  finished_good_id?: string | undefined;
  confidence: "exact" | "partial" | "none";
}

/**
 * Match SKU by exact match, then by normalized comparison
 */
export function matchSku(
  shopifySku: string,
  localSkus: Array<{ id: string; sku: string; finished_good_id?: string | undefined }>
): SkuMatchResult {
  if (!shopifySku) {
    return { matched: false, confidence: "none" };
  }

  // Try exact match first
  const exactMatch = localSkus.find(
    (local) => local.sku.toLowerCase() === shopifySku.toLowerCase()
  );

  if (exactMatch) {
    return {
      matched: true,
      product_sku_id: exactMatch.id,
      finished_good_id: exactMatch.finished_good_id,
      confidence: "exact",
    };
  }

  // Try normalized match (remove spaces, dashes, underscores)
  const normalizedShopifySku = shopifySku
    .toLowerCase()
    .replace(/[-_\s]/g, "");

  const partialMatch = localSkus.find(
    (local) =>
      local.sku.toLowerCase().replace(/[-_\s]/g, "") === normalizedShopifySku
  );

  if (partialMatch) {
    return {
      matched: true,
      product_sku_id: partialMatch.id,
      finished_good_id: partialMatch.finished_good_id,
      confidence: "partial",
    };
  }

  return { matched: false, confidence: "none" };
}

// =============================================================================
// REPORTING HELPERS
// =============================================================================

/**
 * Calculate order fulfillment rate
 */
export function calculateFulfillmentRate(orders: import("../types").Order[]): number {
  if (orders.length === 0) {
    return 0;
  }

  const fulfilled = orders.filter(
    (o) => o.status === "fulfilled" || o.status === "shipped"
  ).length;

  return Math.round((fulfilled / orders.length) * 100);
}

/**
 * Calculate average time to fulfillment (in hours)
 */
export function calculateAvgFulfillmentTime(
  orders: Array<{ order_date: string; shipped_at: string | null }>
): number {
  const fulfilledOrders = orders.filter((o) => o.shipped_at);

  if (fulfilledOrders.length === 0) {
    return 0;
  }

  const totalHours = fulfilledOrders.reduce((sum, order) => {
    const orderDate = new Date(order.order_date);
    const shippedDate = new Date(order.shipped_at!);
    const diffMs = shippedDate.getTime() - orderDate.getTime();
    return sum + diffMs / (1000 * 60 * 60);
  }, 0);

  return Math.round(totalHours / fulfilledOrders.length);
}
