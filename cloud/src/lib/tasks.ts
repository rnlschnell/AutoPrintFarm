/**
 * PrintFarm Cloud - Task Auto-Generation Library
 *
 * Functions for automatically creating worklist and assembly tasks
 * in response to system events (print completion, filament changes, etc.).
 *
 * These functions are designed to be called from:
 * - Queue handlers (print-events.ts)
 * - Route handlers (when jobs complete, etc.)
 * - Automation rules
 */

import type { D1Database } from "@cloudflare/workers-types";
import { generateId } from "./crypto";
import type {
  TaskType,
  TaskPriority,
  PrintJob,
  Printer,
  FinishedGood,
  Product,
} from "../types";

// =============================================================================
// TYPES
// =============================================================================

export interface CreateWorklistTaskOptions {
  tenant_id: string;
  title: string;
  subtitle?: string;
  description?: string;
  task_type: TaskType;
  priority?: TaskPriority;
  assembly_task_id?: string;
  printer_id?: string;
  assigned_to?: string;
  order_number?: string;
  estimated_time_minutes?: number;
  due_date?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAssemblyTaskOptions {
  tenant_id: string;
  finished_good_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  assigned_to?: string;
  notes?: string;
}

export interface TaskCreationResult {
  success: boolean;
  task_id?: string;
  error?: string;
}

// =============================================================================
// WORKLIST TASK CREATION
// =============================================================================

/**
 * Create a worklist task directly in the database
 */
export async function createWorklistTask(
  db: D1Database,
  options: CreateWorklistTaskOptions
): Promise<TaskCreationResult> {
  try {
    const taskId = generateId();
    const now = new Date().toISOString();
    const metadataJson = options.metadata
      ? JSON.stringify(options.metadata)
      : null;

    await db
      .prepare(
        `INSERT INTO worklist_tasks (
          id, tenant_id, title, subtitle, description,
          task_type, priority, status,
          assembly_task_id, printer_id, assigned_to,
          order_number, estimated_time_minutes, due_date,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        taskId,
        options.tenant_id,
        options.title,
        options.subtitle || null,
        options.description || null,
        options.task_type,
        options.priority || "medium",
        options.assembly_task_id || null,
        options.printer_id || null,
        options.assigned_to || null,
        options.order_number || null,
        options.estimated_time_minutes || null,
        options.due_date || null,
        metadataJson,
        now,
        now
      )
      .run();

    return { success: true, task_id: taskId };
  } catch (error) {
    console.error("Failed to create worklist task:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create an assembly task directly in the database
 */
export async function createAssemblyTask(
  db: D1Database,
  options: CreateAssemblyTaskOptions
): Promise<TaskCreationResult> {
  try {
    const taskId = generateId();
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO assembly_tasks (
          id, tenant_id, finished_good_id, assigned_to,
          product_name, sku, quantity, status, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .bind(
        taskId,
        options.tenant_id,
        options.finished_good_id,
        options.assigned_to || null,
        options.product_name,
        options.sku,
        options.quantity,
        options.notes || null,
        now,
        now
      )
      .run();

    return { success: true, task_id: taskId };
  } catch (error) {
    console.error("Failed to create assembly task:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// AUTO-GENERATION FUNCTIONS
// =============================================================================

/**
 * Create a collection task when a print job completes
 * Called by print-events queue handler when a job status changes to 'completed'
 */
export async function createCollectionTask(
  db: D1Database,
  job: PrintJob,
  printer: Printer
): Promise<TaskCreationResult> {
  const estimatedMinutes = 2; // Collection typically takes ~2 minutes

  return createWorklistTask(db, {
    tenant_id: job.tenant_id,
    title: `Collect print from ${printer.name}`,
    subtitle: job.product_name || job.file_name,
    description: `Completed print job ready for collection.\nFile: ${job.file_name}\nUnits: ${job.number_of_units}`,
    task_type: "collection",
    priority: "high", // Collection tasks should be done promptly
    printer_id: printer.id,
    estimated_time_minutes: estimatedMinutes,
    metadata: {
      job_id: job.id,
      print_file_id: job.print_file_id,
      product_id: job.product_id,
      product_sku_id: job.product_sku_id,
      number_of_units: job.number_of_units,
    },
  });
}

/**
 * Create a filament change task when the next job requires a different color/material
 * Called when assigning a job to a printer with mismatched filament
 */
export async function createFilamentChangeTask(
  db: D1Database,
  tenantId: string,
  printer: Printer,
  targetColor: string,
  targetFilamentType: string,
  jobId?: string
): Promise<TaskCreationResult> {
  const estimatedMinutes = 10; // Filament change typically takes ~10 minutes

  const currentInfo = printer.current_color
    ? `${printer.current_color} ${printer.current_filament_type || ""}`
    : "Unknown";

  return createWorklistTask(db, {
    tenant_id: tenantId,
    title: `Change filament on ${printer.name}`,
    subtitle: `${currentInfo} → ${targetColor} ${targetFilamentType}`,
    description: `Filament change required before next print.\nCurrent: ${currentInfo}\nRequired: ${targetColor} ${targetFilamentType}`,
    task_type: "filament_change",
    priority: "high",
    printer_id: printer.id,
    estimated_time_minutes: estimatedMinutes,
    metadata: {
      job_id: jobId,
      current_color: printer.current_color,
      current_filament_type: printer.current_filament_type,
      target_color: targetColor,
      target_filament_type: targetFilamentType,
    },
  });
}

/**
 * Create a maintenance task for a printer
 * Called when maintenance is scheduled or when printer reports issues
 */
export async function createMaintenanceTask(
  db: D1Database,
  tenantId: string,
  printer: Printer,
  maintenanceType: string,
  description?: string,
  priority: TaskPriority = "medium"
): Promise<TaskCreationResult> {
  // Estimate time based on maintenance type
  const estimatedMinutes =
    maintenanceType === "nozzle_clean"
      ? 15
      : maintenanceType === "bed_level"
        ? 20
        : maintenanceType === "lubrication"
          ? 30
          : 60; // Default for other types

  return createWorklistTask(db, {
    tenant_id: tenantId,
    title: `${maintenanceType.replace(/_/g, " ")} - ${printer.name}`,
    subtitle: printer.model,
    description:
      description ||
      `Scheduled maintenance task for printer ${printer.name}.\nType: ${maintenanceType}`,
    task_type: "maintenance",
    priority,
    printer_id: printer.id,
    estimated_time_minutes: estimatedMinutes,
    metadata: {
      maintenance_type: maintenanceType,
      printer_model: printer.model,
      total_print_time: printer.total_print_time,
      last_maintenance_date: printer.last_maintenance_date,
    },
  });
}

/**
 * Create a quality check task for completed prints
 * Called when a job completes for products that require quality inspection
 */
export async function createQualityCheckTask(
  db: D1Database,
  job: PrintJob,
  printer: Printer
): Promise<TaskCreationResult> {
  const estimatedMinutes = 5; // Quality check typically takes ~5 minutes

  return createWorklistTask(db, {
    tenant_id: job.tenant_id,
    title: `Quality check - ${job.product_name || job.file_name}`,
    subtitle: `${job.number_of_units} unit(s) from ${printer.name}`,
    description: `Inspect completed print for quality issues.\nProduct: ${job.product_name || "N/A"}\nSKU: ${job.sku_name || "N/A"}\nUnits: ${job.number_of_units}`,
    task_type: "quality_check",
    priority: "medium",
    printer_id: printer.id,
    estimated_time_minutes: estimatedMinutes,
    metadata: {
      job_id: job.id,
      product_id: job.product_id,
      product_sku_id: job.product_sku_id,
      number_of_units: job.number_of_units,
    },
  });
}

/**
 * Create assembly tasks when prints are completed for products requiring assembly
 * Called when finished goods are created from completed print jobs
 */
export async function createAssemblyTasksForFinishedGood(
  db: D1Database,
  finishedGood: FinishedGood,
  product: Product,
  quantityToAssemble: number
): Promise<TaskCreationResult> {
  // Create the assembly task
  const assemblyResult = await createAssemblyTask(db, {
    tenant_id: finishedGood.tenant_id,
    finished_good_id: finishedGood.id,
    product_name: product.name,
    sku: finishedGood.sku,
    quantity: quantityToAssemble,
    notes: `Auto-generated assembly task for ${quantityToAssemble} unit(s)`,
  });

  if (!assemblyResult.success || !assemblyResult.task_id) {
    return assemblyResult;
  }

  // Also create a corresponding worklist task
  const estimatedMinutes = quantityToAssemble * 5; // Estimate 5 min per unit

  await createWorklistTask(db, {
    tenant_id: finishedGood.tenant_id,
    title: `Assemble ${product.name}`,
    subtitle: `${finishedGood.sku} - ${quantityToAssemble} unit(s)`,
    description: `Assembly required for ${quantityToAssemble} unit(s) of ${product.name}.\nSKU: ${finishedGood.sku}\nColor: ${finishedGood.color}\nMaterial: ${finishedGood.material}`,
    task_type: "assembly",
    priority: "medium",
    assembly_task_id: assemblyResult.task_id,
    estimated_time_minutes: estimatedMinutes,
    metadata: {
      assembly_task_id: assemblyResult.task_id,
      finished_good_id: finishedGood.id,
      product_id: product.id,
      quantity: quantityToAssemble,
    },
  });

  // Return the assembly task result (primary task)
  return assemblyResult;
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Create all tasks needed when a print job completes
 * This is the main entry point called from the print-events queue
 */
export async function handlePrintJobCompletion(
  db: D1Database,
  job: PrintJob,
  printer: Printer,
  options: {
    createCollectionTask?: boolean;
    createQualityCheckTask?: boolean;
  } = {}
): Promise<{
  collection_task?: TaskCreationResult;
  quality_check_task?: TaskCreationResult;
}> {
  const results: {
    collection_task?: TaskCreationResult;
    quality_check_task?: TaskCreationResult;
  } = {};

  // Create collection task (default: true)
  if (options.createCollectionTask !== false) {
    results.collection_task = await createCollectionTask(db, job, printer);
  }

  // Create quality check task if product requires it (default: false)
  if (options.createQualityCheckTask) {
    results.quality_check_task = await createQualityCheckTask(db, job, printer);
  }

  return results;
}

/**
 * Check if a filament change is needed and create task if so
 * Returns true if a filament change task was created
 */
export async function checkAndCreateFilamentChangeTask(
  db: D1Database,
  tenantId: string,
  printer: Printer,
  requiredColor: string,
  requiredFilamentType: string,
  jobId?: string
): Promise<boolean> {
  // Check if filament change is needed
  const colorMatches =
    !printer.current_color ||
    printer.current_color.toLowerCase() === requiredColor.toLowerCase();

  const filamentTypeMatches =
    !printer.current_filament_type ||
    printer.current_filament_type.toLowerCase() ===
      requiredFilamentType.toLowerCase();

  if (colorMatches && filamentTypeMatches) {
    return false; // No change needed
  }

  // Check if there's already a pending filament change task for this printer
  const existingTask = await db
    .prepare(
      `SELECT id FROM worklist_tasks
       WHERE tenant_id = ?
         AND printer_id = ?
         AND task_type = 'filament_change'
         AND status IN ('pending', 'in_progress')`
    )
    .bind(tenantId, printer.id)
    .first();

  if (existingTask) {
    return false; // Task already exists
  }

  // Create the filament change task
  const result = await createFilamentChangeTask(
    db,
    tenantId,
    printer,
    requiredColor,
    requiredFilamentType,
    jobId
  );

  return result.success;
}

/**
 * Get pending task counts for a tenant (useful for dashboard)
 */
export async function getPendingTaskCounts(
  db: D1Database,
  tenantId: string
): Promise<Record<TaskType, number>> {
  const result = await db
    .prepare(
      `SELECT task_type, COUNT(*) as count
       FROM worklist_tasks
       WHERE tenant_id = ? AND status IN ('pending', 'in_progress')
       GROUP BY task_type`
    )
    .bind(tenantId)
    .all<{ task_type: TaskType; count: number }>();

  const counts: Record<TaskType, number> = {
    assembly: 0,
    filament_change: 0,
    collection: 0,
    maintenance: 0,
    quality_check: 0,
  };

  for (const row of result.results || []) {
    counts[row.task_type] = row.count;
  }

  return counts;
}
