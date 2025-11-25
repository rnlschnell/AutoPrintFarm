/**
 * Assembly Routes - Post-Print Assembly Task Management
 *
 * CRUD operations for assembly tasks that track post-print assembly work.
 * Assembly tasks are linked to finished goods and can generate worklist tasks.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { paginate, getCount } from "../lib/db";
import type { AssemblyTask, TaskStatus, FinishedGood } from "../types";

export const assembly = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);

const createAssemblyTaskSchema = z.object({
  finished_good_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  assigned_to: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const updateAssemblyTaskSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  assigned_to: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: taskStatusSchema.optional(),
});

const completeAssemblySchema = z.object({
  quantity_completed: z.number().int().min(1).optional(), // Defaults to task quantity
  notes: z.string().max(2000).optional(),
});

// =============================================================================
// LIST ASSEMBLY TASKS
// =============================================================================

/**
 * GET /api/v1/assembly
 * List all assembly tasks for the current tenant
 * Supports filtering by status, assigned_to, finished_good_id
 * Supports pagination
 */
assembly.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const status = c.req.query("status") as TaskStatus | undefined;
  const assignedTo = c.req.query("assigned_to");
  const finishedGoodId = c.req.query("finished_good_id");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (status) {
    whereClause += " AND status = ?";
    params.push(status);
  }

  if (assignedTo) {
    whereClause += " AND assigned_to = ?";
    params.push(assignedTo);
  }

  if (finishedGoodId) {
    whereClause += " AND finished_good_id = ?";
    params.push(finishedGoodId);
  }

  // Get total count
  const total = await getCount(c.env.DB, "assembly_tasks", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query tasks - order by status (pending/in_progress first), then by created_at
  const query = `
    SELECT * FROM assembly_tasks
    WHERE ${whereClause}
    ORDER BY
      CASE status
        WHEN 'in_progress' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'completed' THEN 3
      END,
      created_at DESC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<AssemblyTask>();

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: offset + (result.results?.length || 0) < total,
    },
  });
});

// =============================================================================
// GET ASSEMBLY TASK STATISTICS
// =============================================================================

/**
 * GET /api/v1/assembly/stats
 * Get assembly task counts by status
 */
assembly.get("/stats", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Get counts by status
  const statusCountsResult = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count, SUM(quantity) as total_quantity
     FROM assembly_tasks
     WHERE tenant_id = ?
     GROUP BY status`
  )
    .bind(tenantId)
    .all<{ status: TaskStatus; count: number; total_quantity: number }>();

  // Transform results
  const byStatus: Record<string, { count: number; total_quantity: number }> = {};
  let totalPending = 0;
  let totalInProgress = 0;

  for (const row of statusCountsResult.results || []) {
    byStatus[row.status] = {
      count: row.count,
      total_quantity: row.total_quantity,
    };
    if (row.status === "pending") {
      totalPending = row.total_quantity;
    } else if (row.status === "in_progress") {
      totalInProgress = row.total_quantity;
    }
  }

  return c.json({
    success: true,
    data: {
      by_status: byStatus,
      total_units_awaiting: totalPending + totalInProgress,
    },
  });
});

// =============================================================================
// GET SINGLE ASSEMBLY TASK
// =============================================================================

/**
 * GET /api/v1/assembly/:id
 * Get a single assembly task by ID, includes finished good details
 */
assembly.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const taskId = c.req.param("id");

  const task = await c.env.DB.prepare(
    "SELECT * FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
  )
    .bind(taskId, tenantId)
    .first<AssemblyTask>();

  if (!task) {
    throw new ApiError("Assembly task not found", 404, "ASSEMBLY_TASK_NOT_FOUND");
  }

  // Optionally fetch finished good details
  const finishedGood = await c.env.DB.prepare(
    "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
  )
    .bind(task.finished_good_id, tenantId)
    .first<FinishedGood>();

  return c.json({
    success: true,
    data: {
      ...task,
      finished_good: finishedGood,
    },
  });
});

// =============================================================================
// GET ASSEMBLY TASK WIKI
// =============================================================================

/**
 * GET /api/v1/assembly/:id/wiki
 * Get the wiki associated with an assembly task's product
 * Lookup chain: AssemblyTask → FinishedGood → ProductSku → Product → wiki_id
 */
assembly.get("/:id/wiki", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const taskId = c.req.param("id");

  // Get task with full product lookup via JOIN
  const result = await c.env.DB.prepare(`
    SELECT
      at.id as task_id,
      p.id as product_id,
      p.name as product_name,
      p.wiki_id
    FROM assembly_tasks at
    JOIN finished_goods fg ON at.finished_good_id = fg.id
    JOIN product_skus ps ON fg.product_sku_id = ps.id
    JOIN products p ON ps.product_id = p.id
    WHERE at.id = ? AND at.tenant_id = ?
  `)
    .bind(taskId, tenantId)
    .first<{
      task_id: string;
      product_id: string;
      product_name: string;
      wiki_id: string | null;
    }>();

  if (!result) {
    throw new ApiError("Assembly task not found", 404, "ASSEMBLY_TASK_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: {
      wiki_id: result.wiki_id,
      product_id: result.product_id,
      product_name: result.product_name,
      message: result.wiki_id ? "Wiki found for product" : "No wiki configured for this product"
    }
  });
});

// =============================================================================
// CREATE ASSEMBLY TASK
// =============================================================================

/**
 * POST /api/v1/assembly
 * Create a new assembly task
 */
assembly.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createAssemblyTaskSchema>;
    try {
      const rawBody = await c.req.json();
      body = createAssemblyTaskSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate finished_good_id
    const finishedGood = await c.env.DB.prepare(
      `SELECT fg.id, fg.sku, fg.requires_assembly, fg.quantity_needs_assembly,
              ps.id as product_sku_id, p.name as product_name
       FROM finished_goods fg
       JOIN product_skus ps ON fg.product_sku_id = ps.id
       JOIN products p ON ps.product_id = p.id
       WHERE fg.id = ? AND fg.tenant_id = ?`
    )
      .bind(body.finished_good_id, tenantId)
      .first<{
        id: string;
        sku: string;
        requires_assembly: number;
        quantity_needs_assembly: number;
        product_sku_id: string;
        product_name: string;
      }>();

    if (!finishedGood) {
      throw new ApiError(
        "Finished good not found",
        404,
        "FINISHED_GOOD_NOT_FOUND"
      );
    }

    // Validate assigned_to if provided
    if (body.assigned_to) {
      const member = await c.env.DB.prepare(
        "SELECT id FROM tenant_members WHERE user_id = ? AND tenant_id = ? AND is_active = 1"
      )
        .bind(body.assigned_to, tenantId)
        .first();

      if (!member) {
        throw new ApiError(
          "User is not a member of this tenant",
          404,
          "USER_NOT_FOUND"
        );
      }
    }

    const taskId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO assembly_tasks (
        id, tenant_id, finished_good_id, assigned_to,
        product_name, sku, quantity, status, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
      .bind(
        taskId,
        tenantId,
        body.finished_good_id,
        body.assigned_to || null,
        finishedGood.product_name,
        finishedGood.sku,
        body.quantity,
        body.notes || null,
        now,
        now
      )
      .run();

    // Fetch the created task
    const task = await c.env.DB.prepare(
      "SELECT * FROM assembly_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<AssemblyTask>();

    return c.json(
      {
        success: true,
        data: task,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE ASSEMBLY TASK
// =============================================================================

/**
 * PUT /api/v1/assembly/:id
 * Update an assembly task
 */
assembly.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists
    const existing = await c.env.DB.prepare(
      "SELECT id, status FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first<{ id: string; status: string }>();

    if (!existing) {
      throw new ApiError("Assembly task not found", 404, "ASSEMBLY_TASK_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateAssemblyTaskSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateAssemblyTaskSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate assigned_to if provided
    if (body.assigned_to) {
      const member = await c.env.DB.prepare(
        "SELECT id FROM tenant_members WHERE user_id = ? AND tenant_id = ? AND is_active = 1"
      )
        .bind(body.assigned_to, tenantId)
        .first();

      if (!member) {
        throw new ApiError(
          "User is not a member of this tenant",
          404,
          "USER_NOT_FOUND"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.quantity !== undefined) {
      updates.push("quantity = ?");
      values.push(body.quantity);
    }

    if (body.assigned_to !== undefined) {
      updates.push("assigned_to = ?");
      values.push(body.assigned_to);
    }

    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(body.notes);
    }

    if (body.status !== undefined) {
      updates.push("status = ?");
      values.push(body.status);

      // Set completed_at if status is completed
      if (body.status === "completed") {
        updates.push("completed_at = ?");
        values.push(new Date().toISOString());
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(taskId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE assembly_tasks SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated task
    const task = await c.env.DB.prepare(
      "SELECT * FROM assembly_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<AssemblyTask>();

    return c.json({
      success: true,
      data: task,
    });
  }
);

// =============================================================================
// COMPLETE ASSEMBLY TASK
// =============================================================================

/**
 * POST /api/v1/assembly/:id/complete
 * Complete an assembly task and update finished goods inventory
 */
assembly.post(
  "/:id/complete",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists and get details
    const existing = await c.env.DB.prepare(
      "SELECT * FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first<AssemblyTask>();

    if (!existing) {
      throw new ApiError("Assembly task not found", 404, "ASSEMBLY_TASK_NOT_FOUND");
    }

    if (existing.status === "completed") {
      throw new ApiError(
        "Assembly task is already completed",
        400,
        "TASK_ALREADY_COMPLETED"
      );
    }

    // Parse and validate request body
    let body: z.infer<typeof completeAssemblySchema>;
    try {
      const rawBody = await c.req.json();
      body = completeAssemblySchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const quantityCompleted = body.quantity_completed || existing.quantity;
    const now = new Date().toISOString();

    // Get the finished good
    const finishedGood = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ? AND tenant_id = ?"
    )
      .bind(existing.finished_good_id, tenantId)
      .first<FinishedGood>();

    if (!finishedGood) {
      throw new ApiError(
        "Finished good not found",
        404,
        "FINISHED_GOOD_NOT_FOUND"
      );
    }

    // Update assembly task
    const taskNotes = body.notes
      ? existing.notes
        ? `${existing.notes}\n---\n${body.notes}`
        : body.notes
      : existing.notes;

    await c.env.DB.prepare(
      `UPDATE assembly_tasks
       SET status = 'completed',
           quantity = ?,
           notes = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(quantityCompleted, taskNotes, now, now, taskId, tenantId)
      .run();

    // Update finished goods inventory
    // Decrease quantity_needs_assembly, increase quantity_assembled
    const newNeedsAssembly = Math.max(
      0,
      finishedGood.quantity_needs_assembly - quantityCompleted
    );
    const newAssembled = finishedGood.quantity_assembled + quantityCompleted;

    // Determine new assembly_status
    let newAssemblyStatus: string = finishedGood.assembly_status;
    if (newNeedsAssembly === 0) {
      newAssemblyStatus = "assembled";
    } else if (newAssembled > 0) {
      newAssemblyStatus = "needs_assembly"; // Partial assembly
    }

    await c.env.DB.prepare(
      `UPDATE finished_goods
       SET quantity_needs_assembly = ?,
           quantity_assembled = ?,
           assembly_status = ?,
           updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
      .bind(
        newNeedsAssembly,
        newAssembled,
        newAssemblyStatus,
        now,
        existing.finished_good_id,
        tenantId
      )
      .run();

    // Fetch updated task
    const task = await c.env.DB.prepare(
      "SELECT * FROM assembly_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<AssemblyTask>();

    // Fetch updated finished good
    const updatedFinishedGood = await c.env.DB.prepare(
      "SELECT * FROM finished_goods WHERE id = ?"
    )
      .bind(existing.finished_good_id)
      .first<FinishedGood>();

    return c.json({
      success: true,
      data: {
        task,
        finished_good: updatedFinishedGood,
      },
    });
  }
);

// =============================================================================
// DELETE ASSEMBLY TASK
// =============================================================================

/**
 * DELETE /api/v1/assembly/:id
 * Delete an assembly task (only if not completed)
 */
assembly.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists
    const existing = await c.env.DB.prepare(
      "SELECT id, status FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first<{ id: string; status: string }>();

    if (!existing) {
      throw new ApiError("Assembly task not found", 404, "ASSEMBLY_TASK_NOT_FOUND");
    }

    // Prevent deletion of completed tasks (for audit purposes)
    if (existing.status === "completed") {
      throw new ApiError(
        "Cannot delete completed assembly tasks",
        400,
        "CANNOT_DELETE_COMPLETED"
      );
    }

    // Delete the task
    await c.env.DB.prepare(
      "DELETE FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Assembly task deleted successfully",
    });
  }
);
