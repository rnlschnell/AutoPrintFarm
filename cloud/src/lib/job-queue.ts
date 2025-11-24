/**
 * Job Queue Logic - Print Job State Management
 *
 * Handles job state machine validation, auto-assignment logic,
 * priority calculation, and queue operations.
 *
 * Phase 7: Print Jobs API
 */

import type { PrintJob, PrintJobStatus, Printer, PrintFile, ProductSku } from "../types";

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Valid state transitions for print jobs.
 * Key is the current state, value is array of valid next states.
 */
export const JOB_STATE_TRANSITIONS: Record<PrintJobStatus, PrintJobStatus[]> = {
  queued: ["processing", "cancelled"],
  processing: ["uploaded", "failed", "cancelled"],
  uploaded: ["printing", "failed", "cancelled"],
  printing: ["completed", "paused", "failed", "cancelled"],
  paused: ["printing", "cancelled"],
  completed: [], // Terminal state
  failed: ["queued"], // Can retry by re-queueing
  cancelled: [], // Terminal state
};

/**
 * Validate if a state transition is allowed
 */
export function validateStatusTransition(
  currentStatus: PrintJobStatus,
  newStatus: PrintJobStatus
): { valid: boolean; message?: string } {
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  const allowedTransitions = JOB_STATE_TRANSITIONS[currentStatus];

  if (!allowedTransitions || allowedTransitions.length === 0) {
    return {
      valid: false,
      message: `Cannot transition from terminal state '${currentStatus}'`,
    };
  }

  if (!allowedTransitions.includes(newStatus)) {
    return {
      valid: false,
      message: `Invalid transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowedTransitions.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Check if a job status is a terminal state
 */
export function isTerminalState(status: PrintJobStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * Check if a job is actively running (not queued, not terminal)
 */
export function isActiveJob(status: PrintJobStatus): boolean {
  return ["processing", "uploaded", "printing", "paused"].includes(status);
}

// =============================================================================
// PRINTER MATCHING & AUTO-ASSIGNMENT
// =============================================================================

export interface MatchCriteria {
  printerModel?: string | null;
  filamentType?: string | null;
  color?: string | null;
  nozzleSize?: number | null;
  bedType?: string | null;
}

export interface PrinterMatch {
  printer: Printer;
  score: number;
  reasons: string[];
}

/**
 * Score a printer for compatibility with a job's requirements.
 * Higher score = better match.
 */
export function scorePrinterMatch(
  printer: Printer,
  criteria: MatchCriteria
): PrinterMatch {
  const reasons: string[] = [];
  let score = 0;

  // Base score for being online and idle
  if (printer.is_connected && printer.status === "idle") {
    score += 100;
    reasons.push("Printer is online and idle");
  } else if (printer.status === "idle") {
    score += 50;
    reasons.push("Printer is idle but may not be connected");
  }

  // Bonus for matching printer model
  if (criteria.printerModel) {
    if (printer.model.toLowerCase().includes(criteria.printerModel.toLowerCase())) {
      score += 50;
      reasons.push(`Model matches: ${printer.model}`);
    } else {
      // Model mismatch is a significant penalty but not disqualifying
      score -= 20;
      reasons.push(`Model mismatch: ${printer.model} vs ${criteria.printerModel}`);
    }
  }

  // Bonus for matching filament type
  if (criteria.filamentType && printer.current_filament_type) {
    if (
      printer.current_filament_type.toLowerCase() ===
      criteria.filamentType.toLowerCase()
    ) {
      score += 30;
      reasons.push(`Filament type matches: ${printer.current_filament_type}`);
    } else {
      // Different filament requires change
      score -= 10;
      reasons.push(`Filament change needed: ${printer.current_filament_type} -> ${criteria.filamentType}`);
    }
  }

  // Bonus for matching color (most valuable for production efficiency)
  if (criteria.color && printer.current_color) {
    if (
      printer.current_color.toLowerCase() === criteria.color.toLowerCase()
    ) {
      score += 40;
      reasons.push(`Color matches: ${printer.current_color}`);
    } else {
      // Different color requires filament change
      score -= 5;
      reasons.push(`Color change needed: ${printer.current_color} -> ${criteria.color}`);
    }
  }

  // Bonus for matching nozzle size
  if (criteria.nozzleSize && printer.nozzle_size) {
    if (printer.nozzle_size === criteria.nozzleSize) {
      score += 20;
      reasons.push(`Nozzle size matches: ${printer.nozzle_size}mm`);
    } else {
      // Different nozzle requires physical change
      score -= 30;
      reasons.push(`Nozzle change needed: ${printer.nozzle_size}mm -> ${criteria.nozzleSize}mm`);
    }
  }

  // Bonus for matching bed type
  if (criteria.bedType && printer.current_build_plate) {
    if (
      printer.current_build_plate.toLowerCase() === criteria.bedType.toLowerCase()
    ) {
      score += 15;
      reasons.push(`Build plate matches: ${printer.current_build_plate}`);
    }
  }

  // Penalty for printers in maintenance
  if (printer.in_maintenance) {
    score -= 200;
    reasons.push("Printer is in maintenance mode");
  }

  // Penalty for printers that aren't active
  if (!printer.is_active) {
    score -= 500;
    reasons.push("Printer is not active");
  }

  // Penalty for printers with errors
  if (printer.status === "error") {
    score -= 300;
    reasons.push("Printer has error status");
  }

  // Penalty for printers already printing
  if (printer.status === "printing") {
    score -= 150;
    reasons.push("Printer is currently printing");
  }

  return {
    printer,
    score,
    reasons,
  };
}

/**
 * Find the best matching printer for a job from a list of available printers.
 * Returns null if no suitable printer is found.
 */
export function findMatchingPrinter(
  printers: Printer[],
  criteria: MatchCriteria,
  minScore = 0
): Printer | null {
  if (printers.length === 0) {
    return null;
  }

  const matches = printers
    .map((printer) => scorePrinterMatch(printer, criteria))
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return matches.length > 0 && matches[0] ? matches[0].printer : null;
}

/**
 * Check if a specific printer is available for a new job
 */
export function checkPrinterAvailability(printer: Printer): {
  available: boolean;
  reason?: string;
} {
  if (!printer.is_active) {
    return { available: false, reason: "Printer is not active" };
  }

  if (printer.in_maintenance) {
    return { available: false, reason: "Printer is in maintenance mode" };
  }

  if (printer.status === "error") {
    return { available: false, reason: "Printer has an error" };
  }

  if (printer.status === "printing") {
    return { available: false, reason: "Printer is currently printing" };
  }

  if (!printer.hub_id) {
    return { available: false, reason: "Printer is not assigned to a hub" };
  }

  return { available: true };
}

// =============================================================================
// PRIORITY CALCULATION
// =============================================================================

/**
 * Priority levels with their base scores.
 * Higher number = higher priority.
 */
export const PRIORITY_LEVELS = {
  LOW: 10,
  NORMAL: 50,
  HIGH: 100,
  URGENT: 200,
} as const;

export interface PriorityFactors {
  baseLevel?: keyof typeof PRIORITY_LEVELS;
  hasOrder?: boolean;
  orderPriority?: number;
  waitTimeMinutes?: number;
  lowStock?: boolean;
  assemblyNeeded?: boolean;
}

/**
 * Calculate the effective priority score for a job.
 * This is used for queue ordering.
 */
export function calculatePriority(factors: PriorityFactors): number {
  let priority = PRIORITY_LEVELS[factors.baseLevel || "NORMAL"];

  // Boost for jobs tied to orders
  if (factors.hasOrder) {
    priority += 30;

    // Additional boost based on order priority (if provided)
    if (factors.orderPriority) {
      priority += factors.orderPriority;
    }
  }

  // Time-based boost (jobs waiting longer get priority bump)
  if (factors.waitTimeMinutes) {
    // Add 1 priority point per 10 minutes waited, up to 50 points
    const timeBoost = Math.min(Math.floor(factors.waitTimeMinutes / 10), 50);
    priority += timeBoost;
  }

  // Boost for low stock items (need to replenish inventory)
  if (factors.lowStock) {
    priority += 25;
  }

  // Slight penalty for assembly items (to prioritize simpler workflow)
  if (factors.assemblyNeeded) {
    priority -= 5;
  }

  return priority;
}

// =============================================================================
// QUEUE OPERATIONS
// =============================================================================

/**
 * Get the next job in queue for a specific printer.
 * Considers priority and matching criteria.
 */
export async function getNextJobForPrinter(
  db: D1Database,
  tenantId: string,
  printerId: string
): Promise<PrintJob | null> {
  // Get jobs that are either:
  // 1. Queued and assigned to this printer
  // 2. Queued and not assigned (general queue)
  const result = await db
    .prepare(
      `SELECT * FROM print_jobs
       WHERE tenant_id = ?
         AND status = 'queued'
         AND (printer_id = ? OR printer_id IS NULL)
       ORDER BY
         CASE WHEN printer_id = ? THEN 0 ELSE 1 END,
         priority DESC,
         time_submitted ASC
       LIMIT 1`
    )
    .bind(tenantId, printerId, printerId)
    .first<PrintJob>();

  return result || null;
}

/**
 * Get all queued jobs for a tenant, ordered by priority
 */
export async function getQueuedJobs(
  db: D1Database,
  tenantId: string,
  limit = 50
): Promise<PrintJob[]> {
  const result = await db
    .prepare(
      `SELECT * FROM print_jobs
       WHERE tenant_id = ? AND status = 'queued'
       ORDER BY priority DESC, time_submitted ASC
       LIMIT ?`
    )
    .bind(tenantId, limit)
    .all<PrintJob>();

  return result.results || [];
}

/**
 * Count jobs by status for a tenant
 */
export async function countJobsByStatus(
  db: D1Database,
  tenantId: string
): Promise<Record<PrintJobStatus, number>> {
  const result = await db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM print_jobs
       WHERE tenant_id = ?
       GROUP BY status`
    )
    .bind(tenantId)
    .all<{ status: PrintJobStatus; count: number }>();

  const counts: Record<PrintJobStatus, number> = {
    queued: 0,
    processing: 0,
    uploaded: 0,
    printing: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const row of result.results || []) {
    counts[row.status] = row.count;
  }

  return counts;
}

// =============================================================================
// JOB CREATION HELPERS
// =============================================================================

/**
 * Build the initial job data from a print file and optional SKU
 */
export function buildJobFromFile(
  file: PrintFile,
  sku?: ProductSku | null,
  overrides?: Partial<PrintJob>
): Partial<PrintJob> {
  const baseJob: Partial<PrintJob> = {
    print_file_id: file.id,
    file_name: file.name,
    number_of_units: file.number_of_units || 1,
    filament_needed_grams: file.filament_weight_grams
      ? Math.round(file.filament_weight_grams * 100) // Store as integer (divide by 100 for display)
      : null,
    estimated_print_time_minutes: file.print_time_seconds
      ? Math.ceil(file.print_time_seconds / 60)
      : null,
    filament_type: file.filament_type || "",
    material_type: file.filament_type || "PLA",
    status: "queued" as PrintJobStatus,
    progress_percentage: 0,
    priority: PRIORITY_LEVELS.NORMAL,
    quantity_per_print: file.number_of_units || 1,
    requires_assembly: 0,
  };

  // Add SKU-related data if provided
  if (sku) {
    baseJob.product_sku_id = sku.id;
    baseJob.color = sku.color;
    baseJob.sku_name = `${sku.color}${sku.filament_type ? ` (${sku.filament_type})` : ""}`;
    baseJob.product_id = sku.product_id;

    if (sku.filament_type) {
      baseJob.filament_type = sku.filament_type;
      baseJob.material_type = sku.filament_type;
    }
  }

  // Apply any overrides
  return {
    ...baseJob,
    ...overrides,
  };
}

/**
 * Denormalize printer info onto a job for display
 */
export function denormalizePrinterInfo(
  job: Partial<PrintJob>,
  printer: Printer
): Partial<PrintJob> {
  return {
    ...job,
    printer_id: printer.id,
    printer_name: printer.name,
    printer_model: printer.model,
    printer_numeric_id: printer.printer_id,
  };
}

// =============================================================================
// EXPORT TYPES
// =============================================================================

export type { PrintJob, PrintJobStatus, Printer, PrintFile, ProductSku };
