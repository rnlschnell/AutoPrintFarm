/**
 * Print Events Queue Consumer
 *
 * Handles print job lifecycle events for downstream processing:
 * - Update inventory on job completion
 * - Create worklist tasks (collection, filament change)
 * - Trigger automation rules
 * - Broadcast status updates to dashboard
 *
 * Phase 7: Print Jobs API
 */

import type { Env, PrintEventMessage } from "../types/env";
import type { PrintJob, FinishedGood, ProductSku } from "../types";
import {
  broadcastJobUpdate,
  broadcastPrinterStatus,
  broadcastInventoryAlert,
} from "../lib/broadcast";
import { sendToDeadLetter } from "../lib/dlq";
import { triggerAutomationRules } from "../lib/automation";

// Re-export types for use by other modules
export type { PrintEventMessage } from "../types/env";

// Define specific event types for type narrowing in handlers
type JobStartedEvent = Extract<PrintEventMessage, { type: "job_started" }>;
type JobProgressEvent = Extract<PrintEventMessage, { type: "job_progress" }>;
type JobCompletedEvent = Extract<PrintEventMessage, { type: "job_completed" }>;
type JobFailedEvent = Extract<PrintEventMessage, { type: "job_failed" }>;
type JobCancelledEvent = Extract<PrintEventMessage, { type: "job_cancelled" }>;
type JobPausedEvent = Extract<PrintEventMessage, { type: "job_paused" }>;
type JobResumedEvent = Extract<PrintEventMessage, { type: "job_resumed" }>;

// =============================================================================
// QUEUE HANDLER
// =============================================================================

/**
 * Main queue handler for print events
 */
export async function handlePrintEventsQueue(
  batch: MessageBatch<PrintEventMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processEvent(message.body, env);
      message.ack();
    } catch (error) {
      console.error(
        `Error processing print event ${message.body.type}:`,
        error
      );

      // Retry with exponential backoff (up to 3 attempts)
      if (message.attempts < 3) {
        const delaySeconds = Math.pow(2, message.attempts) * 10;
        message.retry({ delaySeconds });
      } else {
        // Send to dead letter queue after max retries
        const errorObj = error instanceof Error ? error : new Error(String(error));
        await sendToDeadLetter(
          env,
          "print-events",
          message.body,
          errorObj,
          message.attempts,
          message.body.tenantId
        );
        message.ack();
      }
    }
  }
}

/**
 * Route event to appropriate handler
 */
async function processEvent(
  event: PrintEventMessage,
  env: Env
): Promise<void> {
  console.log(`Processing print event: ${event.type} for job ${event.jobId}`);

  switch (event.type) {
    case "job_started":
      await handleJobStarted(event, env);
      break;
    case "job_progress":
      await handleJobProgress(event, env);
      break;
    case "job_completed":
      await handleJobCompleted(event, env);
      break;
    case "job_failed":
      await handleJobFailed(event, env);
      break;
    case "job_cancelled":
      await handleJobCancelled(event, env);
      break;
    case "job_paused":
      await handleJobPaused(event, env);
      break;
    case "job_resumed":
      await handleJobResumed(event, env);
      break;
    default:
      console.warn(`Unknown event type: ${(event as PrintEventMessage).type}`);
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handle job started event
 * - Update printer status to 'printing'
 * - Broadcast to dashboard
 */
async function handleJobStarted(
  event: JobStartedEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId, hubId: _hubId } = event;

  // Update printer status if we have a printer ID
  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'printing',
        cleared = 0,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), printerId, tenantId)
      .run();

    // Broadcast printer status update to dashboard
    await broadcastPrinterStatus(env, tenantId, printerId, "printing");
  }

  // Broadcast job update to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "printing", 0, printerId || undefined);

  // Trigger automation rules for print_started
  await triggerAutomationRules(env, tenantId, "print_started", {
    jobId,
    ...(printerId && { printerId }),
  });

  console.log(`Job ${jobId} started on printer ${printerId}`);
}

/**
 * Handle job progress event
 * - Update job progress in DB
 * - Broadcast to dashboard
 */
async function handleJobProgress(
  event: JobProgressEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, progressPercentage, printerId } = event;

  // Update job progress
  await env.DB.prepare(
    `UPDATE print_jobs SET
      progress_percentage = ?,
      last_sync_time = ?,
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`
  )
    .bind(
      progressPercentage,
      new Date().toISOString(),
      new Date().toISOString(),
      jobId,
      tenantId
    )
    .run();

  // Broadcast progress to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "printing", progressPercentage, printerId || undefined);
}

/**
 * Handle job completed event
 * - Update inventory/finished goods
 * - Create collection task
 * - Create assembly task if needed
 * - Trigger automation rules
 */
async function handleJobCompleted(
  event: JobCompletedEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId, productSkuId, quantity, requiresAssembly } = event;

  // 1. Update printer status back to idle and mark bed as needs clearing
  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'idle',
        cleared = 0,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), printerId, tenantId)
      .run();
  }

  // 2. Update inventory if we have a product SKU
  if (productSkuId) {
    await updateInventoryOnCompletion(env, tenantId, productSkuId, quantity, requiresAssembly, jobId);
  }

  // 3. Create collection worklist task
  await createCollectionTask(env, tenantId, jobId, printerId);

  // 4. Create assembly task if needed
  if (requiresAssembly && productSkuId) {
    await createAssemblyTask(env, tenantId, jobId, productSkuId, quantity);
  }

  // 5. Trigger automation rules for print_completed
  // Get job details for automation context
  const completedJob = await env.DB.prepare(
    "SELECT file_name FROM print_jobs WHERE id = ? AND tenant_id = ?"
  )
    .bind(jobId, tenantId)
    .first<{ file_name: string }>();

  await triggerAutomationRules(env, tenantId, "print_completed", {
    jobId,
    ...(printerId && { printerId }),
    ...(productSkuId && { productSkuId }),
    quantity,
    ...(completedJob?.file_name && { fileName: completedJob.file_name }),
  });

  // 6. Broadcast job completion to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "completed", 100, printerId || undefined);

  // 7. Broadcast printer status update
  if (printerId) {
    await broadcastPrinterStatus(env, tenantId, printerId, "idle");
  }

  // 8. Check for low stock alerts and broadcast if needed
  if (productSkuId) {
    await checkAndBroadcastLowStockAlert(env, tenantId, productSkuId);
  }

  console.log(`Job ${jobId} completed, quantity: ${quantity}`);
}

/**
 * Handle job failed event
 * - Update printer status
 * - Log failure for analytics
 * - Broadcast to dashboard
 */
async function handleJobFailed(
  event: JobFailedEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId, failureReason, progressAtFailure } = event;

  // 1. Update printer status to error
  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'error',
        connection_error = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(
        failureReason || "Print job failed",
        new Date().toISOString(),
        printerId,
        tenantId
      )
      .run();
  }

  // 2. Get job details for failure logging
  const job = await env.DB.prepare(
    "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
  )
    .bind(jobId, tenantId)
    .first<PrintJob>();

  // 3. Log printer failure for analytics
  if (printerId) {
    const failureId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO printer_failures (
        id, tenant_id, printer_id, print_job_id,
        failure_type, failure_reason, progress_at_failure,
        print_time_at_failure, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        failureId,
        tenantId,
        printerId,
        jobId,
        "unknown", // Failure type would come from hub in real implementation
        failureReason || "Unknown failure",
        progressAtFailure || job?.progress_percentage || 0,
        job?.actual_print_time_minutes || null,
        new Date().toISOString()
      )
      .run();
  }

  // 4. Trigger automation rules for print_failed
  await triggerAutomationRules(env, tenantId, "print_failed", {
    jobId,
    ...(printerId && { printerId }),
    ...(failureReason && { failureReason }),
    ...(progressAtFailure !== undefined && { progressAtFailure }),
  });

  // 5. Broadcast job failure to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "failed", job?.progress_percentage || 0, printerId || undefined);

  // 6. Broadcast printer status update
  if (printerId) {
    await broadcastPrinterStatus(env, tenantId, printerId, "error");
  }

  console.log(`Job ${jobId} failed: ${failureReason}`);
}

/**
 * Handle job cancelled event
 * - Update printer status back to idle
 * - Broadcast to dashboard
 */
async function handleJobCancelled(
  event: JobCancelledEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId } = event;

  // Update printer status back to idle
  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'idle',
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), printerId, tenantId)
      .run();

    // Broadcast printer status update to dashboard
    await broadcastPrinterStatus(env, tenantId, printerId, "idle");
  }

  // Broadcast job cancellation to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "cancelled", 0, printerId || undefined);

  console.log(`Job ${jobId} cancelled`);
}

/**
 * Handle job paused event
 * - Update printer status to paused
 * - Broadcast to dashboard
 */
async function handleJobPaused(
  event: JobPausedEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId } = event;

  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'paused',
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), printerId, tenantId)
      .run();

    // Broadcast printer status update to dashboard
    await broadcastPrinterStatus(env, tenantId, printerId, "paused");
  }

  // Broadcast job paused to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "paused", undefined, printerId || undefined);

  console.log(`Job ${jobId} paused`);
}

/**
 * Handle job resumed event
 * - Update printer status back to printing
 * - Broadcast to dashboard
 */
async function handleJobResumed(
  event: JobResumedEvent,
  env: Env
): Promise<void> {
  const { jobId, tenantId, printerId } = event;

  if (printerId) {
    await env.DB.prepare(
      `UPDATE printers SET
        status = 'printing',
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(new Date().toISOString(), printerId, tenantId)
      .run();

    // Broadcast printer status update to dashboard
    await broadcastPrinterStatus(env, tenantId, printerId, "printing");
  }

  // Broadcast job resumed to dashboard
  await broadcastJobUpdate(env, tenantId, jobId, "printing", undefined, printerId || undefined);

  console.log(`Job ${jobId} resumed`);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Update inventory/finished goods when a print completes
 */
async function updateInventoryOnCompletion(
  env: Env,
  tenantId: string,
  productSkuId: string,
  quantity: number,
  requiresAssembly: boolean,
  jobId: string
): Promise<void> {
  // Get the product SKU for denormalization
  const sku = await env.DB.prepare(
    "SELECT * FROM product_skus WHERE id = ? AND tenant_id = ?"
  )
    .bind(productSkuId, tenantId)
    .first<ProductSku>();

  if (!sku) {
    console.warn(`SKU ${productSkuId} not found, skipping inventory update`);
    return;
  }

  // Check if finished good record exists for this SKU
  const existingGood = await env.DB.prepare(
    "SELECT * FROM finished_goods WHERE product_sku_id = ? AND tenant_id = ?"
  )
    .bind(productSkuId, tenantId)
    .first<FinishedGood>();

  const now = new Date().toISOString();

  if (existingGood) {
    // Update existing finished good
    if (requiresAssembly) {
      // Add to needs_assembly count
      await env.DB.prepare(
        `UPDATE finished_goods SET
          quantity_needs_assembly = quantity_needs_assembly + ?,
          updated_at = ?
         WHERE id = ?`
      )
        .bind(quantity, now, existingGood.id)
        .run();
    } else {
      // Add directly to stock
      await env.DB.prepare(
        `UPDATE finished_goods SET
          current_stock = current_stock + ?,
          updated_at = ?
         WHERE id = ?`
      )
        .bind(quantity, now, existingGood.id)
        .run();
    }

    // Update status based on stock level
    await updateFinishedGoodStatus(env, existingGood.id);
  } else {
    // Create new finished good record
    const goodId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO finished_goods (
        id, tenant_id, product_sku_id, print_job_id,
        sku, color, material,
        current_stock, low_stock_threshold, quantity_per_sku,
        unit_price, extra_cost, profit_margin,
        requires_assembly, quantity_assembled, quantity_needs_assembly,
        status, assembly_status, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        goodId,
        tenantId,
        productSkuId,
        jobId,
        sku.sku,
        sku.color,
        sku.filament_type || "PLA",
        requiresAssembly ? 0 : quantity,
        sku.low_stock_threshold || 5,
        1,
        sku.price || 0,
        0,
        0,
        requiresAssembly ? 1 : 0,
        0,
        requiresAssembly ? quantity : 0,
        "in_stock",
        requiresAssembly ? "needs_assembly" : "printed",
        1,
        now,
        now
      )
      .run();
  }
}

/**
 * Update finished good status based on current stock level
 */
async function updateFinishedGoodStatus(
  env: Env,
  goodId: string
): Promise<void> {
  const good = await env.DB.prepare(
    "SELECT current_stock, low_stock_threshold, quantity_needs_assembly FROM finished_goods WHERE id = ?"
  )
    .bind(goodId)
    .first<{
      current_stock: number;
      low_stock_threshold: number;
      quantity_needs_assembly: number;
    }>();

  if (!good) return;

  let status: string;
  if (good.current_stock <= 0 && good.quantity_needs_assembly <= 0) {
    status = "out_of_stock";
  } else if (good.quantity_needs_assembly > 0) {
    status = "needs_assembly";
  } else if (good.current_stock <= good.low_stock_threshold) {
    status = "low_stock";
  } else {
    status = "in_stock";
  }

  await env.DB.prepare(
    "UPDATE finished_goods SET status = ?, updated_at = ? WHERE id = ?"
  )
    .bind(status, new Date().toISOString(), goodId)
    .run();
}

/**
 * Create a collection task for completed print
 */
async function createCollectionTask(
  env: Env,
  tenantId: string,
  jobId: string,
  printerId: string | null
): Promise<void> {
  // Get job details for task info
  const job = await env.DB.prepare(
    "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
  )
    .bind(jobId, tenantId)
    .first<PrintJob>();

  if (!job) return;

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO worklist_tasks (
      id, tenant_id, printer_id,
      title, subtitle, description,
      task_type, priority, status,
      metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      taskId,
      tenantId,
      printerId,
      `Collect: ${job.file_name}`,
      job.printer_name ? `From ${job.printer_name}` : null,
      `Collect ${job.number_of_units} unit(s) from the printer`,
      "collection",
      "medium",
      "pending",
      JSON.stringify({ jobId, quantity: job.number_of_units }),
      now,
      now
    )
    .run();

  console.log(`Created collection task ${taskId} for job ${jobId}`);
}

/**
 * Create an assembly task for products requiring assembly
 */
async function createAssemblyTask(
  env: Env,
  tenantId: string,
  _jobId: string, // Kept for future use (audit trails, etc.)
  productSkuId: string,
  quantity: number
): Promise<void> {
  // Get finished good for the assembly task
  const finishedGood = await env.DB.prepare(
    "SELECT * FROM finished_goods WHERE product_sku_id = ? AND tenant_id = ?"
  )
    .bind(productSkuId, tenantId)
    .first<FinishedGood>();

  if (!finishedGood) return;

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO assembly_tasks (
      id, tenant_id, finished_good_id,
      product_name, sku, quantity,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      taskId,
      tenantId,
      finishedGood.id,
      finishedGood.sku,
      finishedGood.sku,
      quantity,
      "pending",
      now,
      now
    )
    .run();

  // Also create a worklist task entry for the assembly
  const worklistTaskId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO worklist_tasks (
      id, tenant_id, assembly_task_id,
      title, subtitle, description,
      task_type, priority, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      worklistTaskId,
      tenantId,
      taskId,
      `Assemble: ${finishedGood.sku}`,
      `${quantity} unit(s)`,
      `Assemble ${quantity} ${finishedGood.sku} items`,
      "assembly",
      "medium",
      "pending",
      now,
      now
    )
    .run();

  console.log(`Created assembly task ${taskId} for ${quantity} ${finishedGood.sku}`);
}

/**
 * Check if a product SKU is at low stock and broadcast an alert if so
 */
async function checkAndBroadcastLowStockAlert(
  env: Env,
  tenantId: string,
  productSkuId: string
): Promise<void> {
  // Get the finished good for this SKU
  const finishedGood = await env.DB.prepare(
    "SELECT * FROM finished_goods WHERE product_sku_id = ? AND tenant_id = ?"
  )
    .bind(productSkuId, tenantId)
    .first<FinishedGood>();

  if (!finishedGood) return;

  // Check if stock is at or below threshold
  if (finishedGood.current_stock <= finishedGood.low_stock_threshold) {
    await broadcastInventoryAlert(
      env,
      tenantId,
      productSkuId,
      finishedGood.sku,
      finishedGood.current_stock,
      finishedGood.low_stock_threshold
    );

    // Trigger automation rules for low_stock
    await triggerAutomationRules(env, tenantId, "low_stock", {
      productSkuId,
      currentStock: finishedGood.current_stock,
      threshold: finishedGood.low_stock_threshold,
    });

    console.log(
      `Low stock alert for ${finishedGood.sku}: ${finishedGood.current_stock}/${finishedGood.low_stock_threshold}`
    );
  }
}
