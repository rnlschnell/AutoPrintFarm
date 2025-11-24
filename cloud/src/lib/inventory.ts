/**
 * Inventory Helper Library
 *
 * Helper functions for inventory management operations including
 * stock adjustments, status calculations, and alert detection.
 *
 * Phase 9: Inventory & Finished Goods API
 */

import type { FinishedGood, FinishedGoodStatus } from "../types";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Reasons for stock adjustments - used for audit trail
 */
export type StockAdjustmentReason =
  | "manual"
  | "print_completion"
  | "order_fulfillment"
  | "correction"
  | "assembly_completed"
  | "damaged"
  | "returned"
  | "inventory_count";

/**
 * Result of a stock adjustment operation
 */
export interface StockAdjustmentResult {
  id: string;
  previous_stock: number;
  adjustment: number;
  new_stock: number;
  previous_status: FinishedGoodStatus;
  new_status: FinishedGoodStatus;
  is_low_stock: boolean;
}

/**
 * Inventory statistics summary
 */
export interface InventoryStats {
  total_items: number;
  total_stock: number;
  total_value: number; // In cents
  in_stock_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  needs_assembly_count: number;
  total_needs_assembly: number;
  total_assembled: number;
}

// =============================================================================
// STATUS CALCULATION
// =============================================================================

/**
 * Calculate the appropriate status based on stock levels and assembly state
 */
export function calculateFinishedGoodStatus(
  currentStock: number,
  lowStockThreshold: number,
  quantityNeedsAssembly: number
): FinishedGoodStatus {
  if (currentStock <= 0 && quantityNeedsAssembly <= 0) {
    return "out_of_stock";
  }
  if (quantityNeedsAssembly > 0) {
    return "needs_assembly";
  }
  if (currentStock <= lowStockThreshold) {
    return "low_stock";
  }
  return "in_stock";
}

/**
 * Check if a finished good is below its low stock threshold
 */
export function isLowStock(
  currentStock: number,
  lowStockThreshold: number
): boolean {
  return currentStock <= lowStockThreshold;
}

/**
 * Check if a finished good is out of stock
 */
export function isOutOfStock(
  currentStock: number,
  quantityNeedsAssembly: number
): boolean {
  return currentStock <= 0 && quantityNeedsAssembly <= 0;
}

// =============================================================================
// STOCK VALIDATION
// =============================================================================

/**
 * Validate that a stock adjustment won't result in negative stock
 */
export function validateStockAdjustment(
  currentStock: number,
  adjustment: number
): { valid: boolean; message?: string } {
  const newStock = currentStock + adjustment;

  if (newStock < 0) {
    return {
      valid: false,
      message: `Cannot reduce stock below zero. Current stock: ${currentStock}, adjustment: ${adjustment}, would result in: ${newStock}`,
    };
  }

  return { valid: true };
}

/**
 * Validate that there is enough stock to fulfill an order
 */
export function validateFulfillmentStock(
  currentStock: number,
  quantityNeeded: number
): { valid: boolean; message?: string; available: number } {
  if (currentStock < quantityNeeded) {
    return {
      valid: false,
      message: `Insufficient stock. Available: ${currentStock}, needed: ${quantityNeeded}`,
      available: currentStock,
    };
  }

  return { valid: true, available: currentStock };
}

// =============================================================================
// INVENTORY VALUE CALCULATIONS
// =============================================================================

/**
 * Calculate the total value of a finished good's inventory
 * Value = (current_stock * unit_price) + extra costs
 */
export function calculateItemValue(good: FinishedGood): number {
  return good.current_stock * good.unit_price;
}

/**
 * Calculate the total value including items needing assembly
 */
export function calculateTotalItemValue(good: FinishedGood): number {
  const stockValue = good.current_stock * good.unit_price;
  const needsAssemblyValue = good.quantity_needs_assembly * good.unit_price;
  const assembledValue = good.quantity_assembled * good.unit_price;
  return stockValue + needsAssemblyValue + assembledValue;
}

// =============================================================================
// SQL QUERY BUILDERS
// =============================================================================

/**
 * Build a WHERE clause for filtering finished goods
 */
export function buildInventoryWhereClause(filters: {
  status?: string;
  low_stock?: boolean;
  product_sku_id?: string;
  requires_assembly?: boolean;
  is_active?: boolean;
  search?: string;
}): { clause: string; params: (string | number)[] } {
  const conditions: string[] = ["tenant_id = ?"];
  const params: (string | number)[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters.low_stock) {
    conditions.push("current_stock <= low_stock_threshold");
  }

  if (filters.product_sku_id) {
    conditions.push("product_sku_id = ?");
    params.push(filters.product_sku_id);
  }

  if (filters.requires_assembly !== undefined) {
    conditions.push("requires_assembly = ?");
    params.push(filters.requires_assembly ? 1 : 0);
  }

  if (filters.is_active !== undefined) {
    conditions.push("is_active = ?");
    params.push(filters.is_active ? 1 : 0);
  }

  if (filters.search) {
    conditions.push("(sku LIKE ? OR color LIKE ? OR material LIKE ?)");
    const searchPattern = `%${filters.search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  return {
    clause: conditions.join(" AND "),
    params,
  };
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Prepare batch stock updates for multiple items
 * Returns SQL statements to be executed in a batch
 */
export function prepareBatchStockUpdate(
  updates: Array<{ id: string; adjustment: number }>
): Array<{ sql: string; params: (string | number)[] }> {
  const now = new Date().toISOString();

  return updates.map(({ id, adjustment }) => ({
    sql: `UPDATE finished_goods
          SET current_stock = current_stock + ?, updated_at = ?
          WHERE id = ?`,
    params: [adjustment, now, id],
  }));
}

// =============================================================================
// ALERT HELPERS
// =============================================================================

/**
 * Structure for low stock alert
 */
export interface LowStockAlert {
  id: string;
  sku: string;
  color: string;
  material: string;
  current_stock: number;
  low_stock_threshold: number;
  deficit: number;
  status: FinishedGoodStatus;
}

/**
 * Transform a finished good into a low stock alert
 */
export function createLowStockAlert(good: FinishedGood): LowStockAlert {
  return {
    id: good.id,
    sku: good.sku,
    color: good.color,
    material: good.material,
    current_stock: good.current_stock,
    low_stock_threshold: good.low_stock_threshold,
    deficit: good.low_stock_threshold - good.current_stock,
    status: good.status,
  };
}
