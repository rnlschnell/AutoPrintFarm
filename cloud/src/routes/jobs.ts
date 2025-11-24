/**
 * Print Jobs Routes - Job Queue Management
 *
 * CRUD operations for print jobs, job control, stats, and history.
 * All routes are tenant-scoped.
 *
 * Phase 7: Print Jobs API
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { generateSignedUrlToken } from "../lib/r2";
import { startPrintJob, isHubOnline } from "../lib/hub-commands";
import {
  validateStatusTransition,
  isTerminalState,
  isActiveJob,
  checkPrinterAvailability,
  countJobsByStatus,
  buildJobFromFile,
  denormalizePrinterInfo,
  PRIORITY_LEVELS,
} from "../lib/job-queue";
import type { PrintJob, PrintJobStatus, Printer, PrintFile, ProductSku, Product } from "../types";

export const jobs = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const jobStatusEnum = z.enum([
  "queued",
  "processing",
  "uploaded",
  "printing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

const createJobSchema = z.object({
  print_file_id: z.string().min(1),
  printer_id: z.string().optional(),
  product_sku_id: z.string().optional(),
  color: z.string().max(50).optional(),
  filament_type: z.string().max(50).optional(),
  material_type: z.string().max(50).optional(),
  number_of_units: z.number().int().min(1).default(1),
  priority: z.number().int().min(0).max(255).optional(),
  requires_assembly: z.boolean().default(false),
  quantity_per_print: z.number().int().min(1).default(1),
});

const updateJobSchema = z.object({
  printer_id: z.string().nullable().optional(),
  color: z.string().max(50).optional(),
  filament_type: z.string().max(50).optional(),
  material_type: z.string().max(50).optional(),
  number_of_units: z.number().int().min(1).optional(),
  priority: z.number().int().min(0).max(255).optional(),
  requires_assembly: z.boolean().optional(),
  quantity_per_print: z.number().int().min(1).optional(),
});

const assignJobSchema = z.object({
  printer_id: z.string().min(1),
});

const updateProgressSchema = z.object({
  progress_percentage: z.number().int().min(0).max(100),
  bambu_job_id: z.string().optional(),
});

const completeJobSchema = z.object({
  actual_print_time_minutes: z.number().int().positive().optional(),
  failure_reason: z.string().max(500).optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse date range from query params
 */
function parseDateRange(
  from?: string,
  to?: string
): { from: Date | null; to: Date | null } {
  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  if (from) {
    fromDate = new Date(from);
    if (isNaN(fromDate.getTime())) fromDate = null;
  }

  if (to) {
    toDate = new Date(to);
    if (isNaN(toDate.getTime())) toDate = null;
  }

  return { from: fromDate, to: toDate };
}

// =============================================================================
// LIST JOBS
// =============================================================================

/**
 * GET /api/v1/jobs
 * List all print jobs for the current tenant
 * Supports filtering by status, printer_id, date range
 */
jobs.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Query params
  const status = c.req.query("status") as PrintJobStatus | undefined;
  const printerId = c.req.query("printer_id");
  const printFileId = c.req.query("print_file_id");
  const productSkuId = c.req.query("product_sku_id");
  const fromDate = c.req.query("from");
  const toDate = c.req.query("to");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  let query = "SELECT * FROM print_jobs WHERE tenant_id = ?";
  let countQuery = "SELECT COUNT(*) as count FROM print_jobs WHERE tenant_id = ?";
  const params: (string | number)[] = [tenantId];
  const countParams: (string | number)[] = [tenantId];

  // Filter by status
  if (status) {
    if (!jobStatusEnum.safeParse(status).success) {
      throw new ApiError("Invalid status value", 400, "INVALID_STATUS");
    }
    query += " AND status = ?";
    countQuery += " AND status = ?";
    params.push(status);
    countParams.push(status);
  }

  // Filter by printer
  if (printerId) {
    query += " AND printer_id = ?";
    countQuery += " AND printer_id = ?";
    params.push(printerId);
    countParams.push(printerId);
  }

  // Filter by print file
  if (printFileId) {
    query += " AND print_file_id = ?";
    countQuery += " AND print_file_id = ?";
    params.push(printFileId);
    countParams.push(printFileId);
  }

  // Filter by product SKU
  if (productSkuId) {
    query += " AND product_sku_id = ?";
    countQuery += " AND product_sku_id = ?";
    params.push(productSkuId);
    countParams.push(productSkuId);
  }

  // Date range filter
  const dates = parseDateRange(fromDate, toDate);
  if (dates.from) {
    query += " AND time_submitted >= ?";
    countQuery += " AND time_submitted >= ?";
    params.push(dates.from.toISOString());
    countParams.push(dates.from.toISOString());
  }
  if (dates.to) {
    query += " AND time_submitted <= ?";
    countQuery += " AND time_submitted <= ?";
    params.push(dates.to.toISOString());
    countParams.push(dates.to.toISOString());
  }

  // Order by priority and submission time
  query += " ORDER BY priority DESC, time_submitted ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const [result, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all<PrintJob>(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: countResult?.count || 0,
      limit,
      offset,
      hasMore: offset + (result.results?.length || 0) < (countResult?.count || 0),
    },
  });
});

// =============================================================================
// GET STATS
// =============================================================================

/**
 * GET /api/v1/jobs/stats
 * Get job counts by status for the current tenant
 */
jobs.get("/stats", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const counts = await countJobsByStatus(c.env.DB, tenantId);

  // Calculate some aggregate stats
  const activeJobs =
    counts.processing + counts.uploaded + counts.printing + counts.paused;
  const completedToday = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM print_jobs
     WHERE tenant_id = ? AND status = 'completed'
       AND time_completed >= date('now', 'start of day')`
  )
    .bind(tenantId)
    .first<{ count: number }>();

  return c.json({
    success: true,
    data: {
      by_status: counts,
      summary: {
        queued: counts.queued,
        active: activeJobs,
        completed: counts.completed,
        failed: counts.failed,
        cancelled: counts.cancelled,
        completed_today: completedToday?.count || 0,
      },
    },
  });
});

// =============================================================================
// GET HISTORY
// =============================================================================

/**
 * GET /api/v1/jobs/history
 * Get completed job history with pagination
 */
jobs.get("/history", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const fromDate = c.req.query("from");
  const toDate = c.req.query("to");

  let query = `SELECT * FROM print_jobs WHERE tenant_id = ? AND status IN ('completed', 'failed', 'cancelled')`;
  let countQuery = `SELECT COUNT(*) as count FROM print_jobs WHERE tenant_id = ? AND status IN ('completed', 'failed', 'cancelled')`;
  const params: (string | number)[] = [tenantId];
  const countParams: (string | number)[] = [tenantId];

  const dates = parseDateRange(fromDate, toDate);
  if (dates.from) {
    query += " AND time_completed >= ?";
    countQuery += " AND time_completed >= ?";
    params.push(dates.from.toISOString());
    countParams.push(dates.from.toISOString());
  }
  if (dates.to) {
    query += " AND time_completed <= ?";
    countQuery += " AND time_completed <= ?";
    params.push(dates.to.toISOString());
    countParams.push(dates.to.toISOString());
  }

  query += " ORDER BY time_completed DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const [result, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all<PrintJob>(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: countResult?.count || 0,
      limit,
      offset,
      hasMore: offset + (result.results?.length || 0) < (countResult?.count || 0),
    },
  });
});

// =============================================================================
// GET SINGLE JOB
// =============================================================================

/**
 * GET /api/v1/jobs/:id
 * Get a single print job by ID
 */
jobs.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const jobId = c.req.param("id");

  const job = await c.env.DB.prepare(
    "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
  )
    .bind(jobId, tenantId)
    .first<PrintJob>();

  if (!job) {
    throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: job,
  });
});

// =============================================================================
// CREATE JOB
// =============================================================================

/**
 * POST /api/v1/jobs
 * Create/queue a new print job
 */
jobs.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const userId = c.get("userId");

    let body: z.infer<typeof createJobSchema>;
    try {
      const rawBody = await c.req.json();
      body = createJobSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate print file exists
    const printFile = await c.env.DB.prepare(
      "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.print_file_id, tenantId)
      .first<PrintFile>();

    if (!printFile) {
      throw new ApiError(
        "Print file not found or does not belong to this tenant",
        404,
        "FILE_NOT_FOUND"
      );
    }

    // Validate printer if provided
    let printer: Printer | null = null;
    if (body.printer_id) {
      printer = await c.env.DB.prepare(
        "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.printer_id, tenantId)
        .first<Printer>();

      if (!printer) {
        throw new ApiError(
          "Printer not found or does not belong to this tenant",
          404,
          "PRINTER_NOT_FOUND"
        );
      }
    }

    // Validate product SKU if provided
    let productSku: ProductSku | null = null;
    let product: Product | null = null;
    if (body.product_sku_id) {
      productSku = await c.env.DB.prepare(
        "SELECT * FROM product_skus WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.product_sku_id, tenantId)
        .first<ProductSku>();

      if (!productSku) {
        throw new ApiError(
          "Product SKU not found or does not belong to this tenant",
          404,
          "SKU_NOT_FOUND"
        );
      }

      // Get product for denormalization
      product = await c.env.DB.prepare(
        "SELECT * FROM products WHERE id = ?"
      )
        .bind(productSku.product_id)
        .first<Product>();
    }

    // Build job data
    const jobId = generateId();
    const now = new Date().toISOString();

    // Start with file-based defaults
    let jobData = buildJobFromFile(printFile, productSku);

    // Apply request body overrides
    jobData = {
      ...jobData,
      id: jobId,
      tenant_id: tenantId,
      submitted_by: userId || null,
      time_submitted: now,
      created_at: now,
      updated_at: now,
      // User-provided values override defaults
      color: body.color || jobData.color || "",
      filament_type: body.filament_type || jobData.filament_type || "",
      material_type: body.material_type || jobData.material_type || "PLA",
      number_of_units: body.number_of_units,
      priority: body.priority ?? PRIORITY_LEVELS.NORMAL,
      requires_assembly: body.requires_assembly ? 1 : 0,
      quantity_per_print: body.quantity_per_print,
    };

    // Denormalize printer info if assigned
    if (printer) {
      jobData = denormalizePrinterInfo(jobData, printer);
    }

    // Denormalize product info if SKU provided
    if (product) {
      jobData.product_id = product.id;
      jobData.product_name = product.name;
    }

    // Insert the job
    await c.env.DB.prepare(
      `INSERT INTO print_jobs (
        id, tenant_id, printer_id, print_file_id, product_sku_id, submitted_by,
        file_name, status, color, filament_type, material_type, number_of_units,
        filament_needed_grams, estimated_print_time_minutes, progress_percentage,
        priority, time_submitted, requires_assembly, quantity_per_print,
        product_id, product_name, sku_name, printer_model, printer_name, printer_numeric_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobData.id,
        jobData.tenant_id,
        jobData.printer_id || null,
        jobData.print_file_id,
        jobData.product_sku_id || null,
        jobData.submitted_by || null,
        jobData.file_name,
        jobData.status,
        jobData.color || "",
        jobData.filament_type || "",
        jobData.material_type || "PLA",
        jobData.number_of_units,
        jobData.filament_needed_grams || null,
        jobData.estimated_print_time_minutes || null,
        jobData.progress_percentage || 0,
        jobData.priority,
        jobData.time_submitted,
        jobData.requires_assembly || 0,
        jobData.quantity_per_print || 1,
        jobData.product_id || null,
        jobData.product_name || null,
        jobData.sku_name || null,
        jobData.printer_model || null,
        jobData.printer_name || null,
        jobData.printer_numeric_id || null,
        jobData.created_at,
        jobData.updated_at
      )
      .run();

    // Fetch the created job
    const createdJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json(
      {
        success: true,
        data: createdJob,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE JOB
// =============================================================================

/**
 * PUT /api/v1/jobs/:id
 * Update a print job's metadata (only if not in terminal state)
 */
jobs.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    // Get existing job
    const existingJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!existingJob) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Cannot update terminal jobs
    if (isTerminalState(existingJob.status)) {
      throw new ApiError(
        `Cannot update a job in '${existingJob.status}' status`,
        400,
        "JOB_TERMINAL"
      );
    }

    let body: z.infer<typeof updateJobSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateJobSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate new printer if provided
    if (body.printer_id) {
      const printer = await c.env.DB.prepare(
        "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.printer_id, tenantId)
        .first<Printer>();

      if (!printer) {
        throw new ApiError(
          "Printer not found or does not belong to this tenant",
          404,
          "PRINTER_NOT_FOUND"
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
      { key: "printer_id", column: "printer_id" },
      { key: "color", column: "color" },
      { key: "filament_type", column: "filament_type" },
      { key: "material_type", column: "material_type" },
      { key: "number_of_units", column: "number_of_units" },
      { key: "priority", column: "priority" },
      {
        key: "requires_assembly",
        column: "requires_assembly",
        transform: (v) => (v ? 1 : 0),
      },
      { key: "quantity_per_print", column: "quantity_per_print" },
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

    values.push(jobId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE print_jobs SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated job
    const updatedJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json({
      success: true,
      data: updatedJob,
    });
  }
);

// =============================================================================
// DELETE JOB
// =============================================================================

/**
 * DELETE /api/v1/jobs/:id
 * Delete/cancel a print job (only if not actively printing)
 */
jobs.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Cannot delete actively printing jobs - use cancel instead
    if (job.status === "printing") {
      throw new ApiError(
        "Cannot delete a printing job. Use cancel instead.",
        400,
        "JOB_PRINTING"
      );
    }

    await c.env.DB.prepare(
      "DELETE FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Print job deleted successfully",
    });
  }
);

// =============================================================================
// ASSIGN JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/assign
 * Assign a queued job to a printer
 */
jobs.post(
  "/:id/assign",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    if (job.status !== "queued") {
      throw new ApiError(
        `Can only assign jobs in 'queued' status, current status: '${job.status}'`,
        400,
        "INVALID_STATUS"
      );
    }

    let body: z.infer<typeof assignJobSchema>;
    try {
      const rawBody = await c.req.json();
      body = assignJobSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate printer exists and belongs to tenant
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.printer_id, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    // Check printer availability
    const availability = checkPrinterAvailability(printer);
    if (!availability.available) {
      throw new ApiError(
        `Printer not available: ${availability.reason}`,
        400,
        "PRINTER_UNAVAILABLE"
      );
    }

    const now = new Date().toISOString();

    // Update job with printer assignment
    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        printer_id = ?,
        printer_name = ?,
        printer_model = ?,
        printer_numeric_id = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(
        printer.id,
        printer.name,
        printer.model,
        printer.printer_id,
        now,
        jobId,
        tenantId
      )
      .run();

    // Fetch updated job
    const updatedJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json({
      success: true,
      data: updatedJob,
      message: `Job assigned to printer '${printer.name}'`,
    });
  }
);

// =============================================================================
// START JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/start
 * Start a print job (sends command to hub)
 */
jobs.post(
  "/:id/start",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "processing");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    // Must have a printer assigned
    if (!job.printer_id) {
      throw new ApiError(
        "Job must be assigned to a printer before starting",
        400,
        "NO_PRINTER_ASSIGNED"
      );
    }

    // Get printer to verify it's available
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(job.printer_id, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Assigned printer not found", 404, "PRINTER_NOT_FOUND");
    }

    const availability = checkPrinterAvailability(printer);
    if (!availability.available) {
      throw new ApiError(
        `Printer not available: ${availability.reason}`,
        400,
        "PRINTER_UNAVAILABLE"
      );
    }

    // Verify printer has a hub assigned
    if (!printer.hub_id) {
      throw new ApiError(
        "Printer is not assigned to a hub",
        400,
        "NO_HUB_ASSIGNED"
      );
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, printer.hub_id);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Get the print file to generate download URL
    const printFile = await c.env.DB.prepare(
      "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(job.print_file_id, tenantId)
      .first<PrintFile>();

    if (!printFile || !printFile.r2_key) {
      throw new ApiError(
        "Print file not found or not uploaded",
        404,
        "FILE_NOT_FOUND"
      );
    }

    const now = new Date().toISOString();

    // Generate a signed URL for the hub to download the file
    // The URL is valid for 1 hour
    const signedToken = await generateSignedUrlToken(
      printFile.r2_key,
      c.env.ENCRYPTION_KEY,
      { expiresIn: 3600 } // 1 hour expiry
    );

    // Construct the full download URL
    const baseUrl = c.req.url.split("/api/")[0];
    const fileUrl = `${baseUrl}/api/v1/files/download/${signedToken}`;

    // Update job status to processing
    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        status = 'processing',
        time_started = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, now, jobId, tenantId)
      .run();

    // Send print command to hub via Durable Object
    const result = await startPrintJob(
      c.env,
      printer.hub_id,
      printer.serial_number || printer.id,
      jobId,
      fileUrl,
      printFile.name,
      false // don't wait for ack - file transfer takes time
    );

    // Queue print event for tracking
    await c.env.PRINT_EVENTS.send({
      type: "job_started",
      jobId,
      tenantId,
      printerId: job.printer_id,
      hubId: printer.hub_id,
      commandId: result.command_id,
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      message: "Print job started - file transfer in progress",
      data: {
        job_id: jobId,
        printer_id: job.printer_id,
        hub_id: printer.hub_id,
        command_id: result.command_id,
        status: "processing",
      },
    });
  }
);

// =============================================================================
// PAUSE JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/pause
 * Pause an actively printing job
 */
jobs.post(
  "/:id/pause",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "paused");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    const now = new Date().toISOString();
    const commandId = generateId();

    // Update job status
    await c.env.DB.prepare(
      `UPDATE print_jobs SET status = 'paused', updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, jobId, tenantId)
      .run();

    // Queue pause event
    await c.env.PRINT_EVENTS.send({
      type: "job_paused",
      jobId,
      tenantId,
      printerId: job.printer_id,
      commandId,
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      message: "Print job paused",
      data: {
        job_id: jobId,
        command_id: commandId,
        status: "paused",
      },
    });
  }
);

// =============================================================================
// RESUME JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/resume
 * Resume a paused print job
 */
jobs.post(
  "/:id/resume",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "printing");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    const now = new Date().toISOString();
    const commandId = generateId();

    // Update job status
    await c.env.DB.prepare(
      `UPDATE print_jobs SET status = 'printing', updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, jobId, tenantId)
      .run();

    // Queue resume event
    await c.env.PRINT_EVENTS.send({
      type: "job_resumed",
      jobId,
      tenantId,
      printerId: job.printer_id,
      commandId,
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      message: "Print job resumed",
      data: {
        job_id: jobId,
        command_id: commandId,
        status: "printing",
      },
    });
  }
);

// =============================================================================
// CANCEL JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/cancel
 * Cancel a print job
 */
jobs.post(
  "/:id/cancel",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "cancelled");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    const now = new Date().toISOString();
    const commandId = generateId();

    // Update job status
    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        status = 'cancelled',
        time_completed = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, now, jobId, tenantId)
      .run();

    // Queue cancel event
    await c.env.PRINT_EVENTS.send({
      type: "job_cancelled",
      jobId,
      tenantId,
      printerId: job.printer_id,
      commandId,
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      message: "Print job cancelled",
      data: {
        job_id: jobId,
        command_id: commandId,
        status: "cancelled",
      },
    });
  }
);

// =============================================================================
// COMPLETE JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/complete
 * Mark a print job as completed (typically called from hub events)
 */
jobs.post(
  "/:id/complete",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "completed");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    let body: z.infer<typeof completeJobSchema> = {};
    try {
      const rawBody = await c.req.json();
      body = completeJobSchema.parse(rawBody);
    } catch {
      // Optional body, ignore parse errors
    }

    const now = new Date().toISOString();

    // Calculate actual print time if not provided
    let actualPrintTime = body.actual_print_time_minutes;
    if (!actualPrintTime && job.time_started) {
      const startTime = new Date(job.time_started).getTime();
      const endTime = Date.now();
      actualPrintTime = Math.ceil((endTime - startTime) / 60000);
    }

    // Update job status
    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        status = 'completed',
        progress_percentage = 100,
        time_completed = ?,
        actual_print_time_minutes = COALESCE(?, actual_print_time_minutes),
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, actualPrintTime || null, now, jobId, tenantId)
      .run();

    // Queue completion event for downstream processing
    await c.env.PRINT_EVENTS.send({
      type: "job_completed",
      jobId,
      tenantId,
      printerId: job.printer_id,
      productSkuId: job.product_sku_id,
      quantity: job.number_of_units,
      requiresAssembly: Boolean(job.requires_assembly),
      timestamp: Date.now(),
    });

    // Fetch updated job
    const updatedJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json({
      success: true,
      message: "Print job completed",
      data: updatedJob,
    });
  }
);

// =============================================================================
// UPDATE PROGRESS
// =============================================================================

/**
 * PUT /api/v1/jobs/:id/progress
 * Update job progress (typically called from hub status updates)
 */
jobs.put(
  "/:id/progress",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Can only update progress for active jobs
    if (!isActiveJob(job.status)) {
      throw new ApiError(
        `Cannot update progress for job in '${job.status}' status`,
        400,
        "INVALID_STATUS"
      );
    }

    let body: z.infer<typeof updateProgressSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateProgressSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();

    // Build update based on provided fields
    const updates: string[] = ["progress_percentage = ?", "last_sync_time = ?", "updated_at = ?"];
    const values: (string | number | null)[] = [body.progress_percentage, now, now];

    if (body.bambu_job_id) {
      updates.push("bambu_job_id = ?");
      values.push(body.bambu_job_id);
    }

    // If status is uploaded and we're now getting progress, transition to printing
    if (job.status === "uploaded" && body.progress_percentage > 0) {
      updates.push("status = ?");
      values.push("printing");
    }

    values.push(jobId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE print_jobs SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    return c.json({
      success: true,
      message: "Progress updated",
      data: {
        job_id: jobId,
        progress_percentage: body.progress_percentage,
      },
    });
  }
);

// =============================================================================
// MARK JOB FAILED
// =============================================================================

/**
 * POST /api/v1/jobs/:id/fail
 * Mark a print job as failed
 */
jobs.post(
  "/:id/fail",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    // Validate state transition
    const transition = validateStatusTransition(job.status, "failed");
    if (!transition.valid) {
      throw new ApiError(transition.message!, 400, "INVALID_TRANSITION");
    }

    let body: z.infer<typeof completeJobSchema> = {};
    try {
      const rawBody = await c.req.json();
      body = completeJobSchema.parse(rawBody);
    } catch {
      // Optional body
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        status = 'failed',
        failure_reason = ?,
        time_completed = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(body.failure_reason || null, now, now, jobId, tenantId)
      .run();

    // Queue failure event
    const failedEvent: Parameters<typeof c.env.PRINT_EVENTS.send>[0] = {
      type: "job_failed",
      jobId,
      tenantId,
      printerId: job.printer_id,
      progressAtFailure: job.progress_percentage,
      timestamp: Date.now(),
    };
    if (body.failure_reason) {
      failedEvent.failureReason = body.failure_reason;
    }
    await c.env.PRINT_EVENTS.send(failedEvent);

    // Fetch updated job
    const updatedJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json({
      success: true,
      message: "Print job marked as failed",
      data: updatedJob,
    });
  }
);

// =============================================================================
// RETRY FAILED JOB
// =============================================================================

/**
 * POST /api/v1/jobs/:id/retry
 * Retry a failed job by re-queueing it
 */
jobs.post(
  "/:id/retry",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const jobId = c.req.param("id");

    const job = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ? AND tenant_id = ?"
    )
      .bind(jobId, tenantId)
      .first<PrintJob>();

    if (!job) {
      throw new ApiError("Print job not found", 404, "JOB_NOT_FOUND");
    }

    if (job.status !== "failed") {
      throw new ApiError(
        "Can only retry failed jobs",
        400,
        "INVALID_STATUS"
      );
    }

    const now = new Date().toISOString();

    // Reset job to queued status
    await c.env.DB.prepare(
      `UPDATE print_jobs SET
        status = 'queued',
        progress_percentage = 0,
        failure_reason = NULL,
        time_started = NULL,
        time_completed = NULL,
        bambu_job_id = NULL,
        actual_print_time_minutes = NULL,
        time_submitted = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, now, jobId, tenantId)
      .run();

    // Fetch updated job
    const updatedJob = await c.env.DB.prepare(
      "SELECT * FROM print_jobs WHERE id = ?"
    )
      .bind(jobId)
      .first<PrintJob>();

    return c.json({
      success: true,
      message: "Job re-queued for retry",
      data: updatedJob,
    });
  }
);
