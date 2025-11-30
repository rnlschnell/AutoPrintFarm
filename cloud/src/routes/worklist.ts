/**
 * Worklist Routes - General Task Management
 *
 * CRUD operations for worklist tasks including collection, filament change,
 * maintenance, and quality check tasks.
 * All routes are tenant-scoped.
 */

import { Hono, Context } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { paginate, getCount } from "../lib/db";
import type { WorklistTask, TaskType, TaskStatus, TaskPriority } from "../types";

export const worklist = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const taskTypeSchema = z.enum([
  "assembly",
  "filament_change",
  "collection",
  "maintenance",
  "quality_check",
]);

const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const taskPrioritySchema = z.enum(["low", "medium", "high"]);

const createWorklistTaskSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  task_type: taskTypeSchema,
  priority: taskPrioritySchema.default("medium"),
  assembly_task_id: z.string().optional(),
  printer_id: z.string().optional(),
  assigned_to: z.string().optional(),
  estimated_time_minutes: z.number().int().min(0).optional(),
  due_date: z.string().optional(), // ISO8601 date string
  metadata: z.record(z.unknown()).optional(), // Will be JSON stringified
});

const updateWorklistTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  task_type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  assembly_task_id: z.string().nullable().optional(),
  printer_id: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  estimated_time_minutes: z.number().int().min(0).nullable().optional(),
  actual_time_minutes: z.number().int().min(0).nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const updateStatusSchema = z.object({
  status: taskStatusSchema,
});

const assignTaskSchema = z.object({
  assigned_to: z.string().nullable(),
});

// =============================================================================
// LIST WORKLIST TASKS
// =============================================================================

/**
 * GET /api/v1/worklist
 * List all worklist tasks for the current tenant
 * Supports filtering by task_type, status, priority, assigned_to, printer_id
 * Supports pagination
 */
worklist.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const taskType = c.req.query("task_type") as TaskType | undefined;
  const status = c.req.query("status") as TaskStatus | undefined;
  const priority = c.req.query("priority") as TaskPriority | undefined;
  const assignedTo = c.req.query("assigned_to");
  const printerId = c.req.query("printer_id");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (taskType) {
    whereClause += " AND task_type = ?";
    params.push(taskType);
  }

  if (status) {
    whereClause += " AND status = ?";
    params.push(status);
  }

  if (priority) {
    whereClause += " AND priority = ?";
    params.push(priority);
  }

  if (assignedTo) {
    whereClause += " AND assigned_to = ?";
    params.push(assignedTo);
  }

  if (printerId) {
    whereClause += " AND printer_id = ?";
    params.push(printerId);
  }

  // Get total count
  const total = await getCount(c.env.DB, "worklist_tasks", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query tasks - order by priority (high first), then by created_at
  const query = `
    SELECT * FROM worklist_tasks
    WHERE ${whereClause}
    ORDER BY
      CASE priority
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END,
      created_at DESC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<WorklistTask>();

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
// GET TASK STATISTICS
// =============================================================================

/**
 * GET /api/v1/worklist/stats
 * Get task counts by status and type
 */
worklist.get("/stats", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Get counts by status
  const statusCountsResult = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM worklist_tasks
     WHERE tenant_id = ?
     GROUP BY status`
  )
    .bind(tenantId)
    .all<{ status: TaskStatus; count: number }>();

  // Get counts by type
  const typeCountsResult = await c.env.DB.prepare(
    `SELECT task_type, COUNT(*) as count
     FROM worklist_tasks
     WHERE tenant_id = ? AND status != 'completed' AND status != 'cancelled'
     GROUP BY task_type`
  )
    .bind(tenantId)
    .all<{ task_type: TaskType; count: number }>();

  // Get overdue tasks count
  const overdueResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count
     FROM worklist_tasks
     WHERE tenant_id = ?
       AND due_date IS NOT NULL
       AND due_date < datetime('now')
       AND status NOT IN ('completed', 'cancelled')`
  )
    .bind(tenantId)
    .first<{ count: number }>();

  // Transform results
  const byStatus: Record<string, number> = {};
  for (const row of statusCountsResult.results || []) {
    byStatus[row.status] = row.count;
  }

  const byType: Record<string, number> = {};
  for (const row of typeCountsResult.results || []) {
    byType[row.task_type] = row.count;
  }

  return c.json({
    success: true,
    data: {
      by_status: byStatus,
      by_type: byType,
      overdue: overdueResult?.count || 0,
      total_active:
        (byStatus.pending || 0) + (byStatus.in_progress || 0),
    },
  });
});

// =============================================================================
// GET SINGLE TASK
// =============================================================================

/**
 * GET /api/v1/worklist/:id
 * Get a single worklist task by ID
 */
worklist.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const taskId = c.req.param("id");

  const task = await c.env.DB.prepare(
    "SELECT * FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
  )
    .bind(taskId, tenantId)
    .first<WorklistTask>();

  if (!task) {
    throw new ApiError("Task not found", 404, "TASK_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: task,
  });
});

// =============================================================================
// CREATE TASK
// =============================================================================

/**
 * POST /api/v1/worklist
 * Create a new worklist task
 */
worklist.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createWorklistTaskSchema>;
    try {
      const rawBody = await c.req.json();
      body = createWorklistTaskSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate assembly_task_id if provided
    if (body.assembly_task_id) {
      const assemblyTask = await c.env.DB.prepare(
        "SELECT id FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.assembly_task_id, tenantId)
        .first();

      if (!assemblyTask) {
        throw new ApiError(
          "Assembly task not found",
          404,
          "ASSEMBLY_TASK_NOT_FOUND"
        );
      }
    }

    // Validate printer_id if provided
    if (body.printer_id) {
      const printer = await c.env.DB.prepare(
        "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.printer_id, tenantId)
        .first();

      if (!printer) {
        throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
      }
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

    // Serialize metadata to JSON
    const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null;

    await c.env.DB.prepare(
      `INSERT INTO worklist_tasks (
        id, tenant_id, title, subtitle, description,
        task_type, priority, status,
        assembly_task_id, printer_id, assigned_to,
        estimated_time_minutes, due_date,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        taskId,
        tenantId,
        body.title,
        body.subtitle || null,
        body.description || null,
        body.task_type,
        body.priority,
        body.assembly_task_id || null,
        body.printer_id || null,
        body.assigned_to || null,
        body.estimated_time_minutes || null,
        body.due_date || null,
        metadataJson,
        now,
        now
      )
      .run();

    // Fetch the created task
    const task = await c.env.DB.prepare(
      "SELECT * FROM worklist_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<WorklistTask>();

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
// UPDATE TASK
// =============================================================================

/**
 * PUT/PATCH /api/v1/worklist/:id
 * Update a worklist task
 */
const updateTaskHandler = async (c: Context<HonoEnv>) => {
  const tenantId = c.get("tenantId")!;
  const taskId = c.req.param("id");

  // Check task exists
  const existing = await c.env.DB.prepare(
    "SELECT id, status, started_at FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
  )
    .bind(taskId, tenantId)
    .first<{ id: string; status: string; started_at: string | null }>();

  if (!existing) {
    throw new ApiError("Task not found", 404, "TASK_NOT_FOUND");
  }

  // Parse and validate request body
  let body: z.infer<typeof updateWorklistTaskSchema>;
  try {
    const rawBody = await c.req.json();
    body = updateWorklistTaskSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error;
    }
    throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
  }

  // Validate assembly_task_id if provided
  if (body.assembly_task_id) {
    const assemblyTask = await c.env.DB.prepare(
      "SELECT id FROM assembly_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.assembly_task_id, tenantId)
      .first();

    if (!assemblyTask) {
      throw new ApiError(
        "Assembly task not found",
        404,
        "ASSEMBLY_TASK_NOT_FOUND"
      );
    }
  }

  // Validate printer_id if provided
  if (body.printer_id) {
    const printer = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.printer_id, tenantId)
      .first();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }
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

  const now = new Date().toISOString();

  // Build dynamic update
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  const fields: Array<{
    key: keyof typeof body;
    column: string;
    transform?: (v: unknown) => unknown;
  }> = [
    { key: "title", column: "title" },
    { key: "subtitle", column: "subtitle" },
    { key: "description", column: "description" },
    { key: "task_type", column: "task_type" },
    { key: "priority", column: "priority" },
    { key: "status", column: "status" },
    { key: "assembly_task_id", column: "assembly_task_id" },
    { key: "printer_id", column: "printer_id" },
    { key: "assigned_to", column: "assigned_to" },
    { key: "estimated_time_minutes", column: "estimated_time_minutes" },
    { key: "actual_time_minutes", column: "actual_time_minutes" },
    { key: "started_at", column: "started_at" },
    { key: "completed_at", column: "completed_at" },
    { key: "due_date", column: "due_date" },
    {
      key: "metadata",
      column: "metadata",
      transform: (v) => (v ? JSON.stringify(v) : null),
    },
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

  // Handle automatic timestamp updates for status changes
  if (body.status === "in_progress" && !existing.started_at && !body.started_at) {
    updates.push("started_at = ?");
    values.push(now);
  }

  if ((body.status === "completed" || body.status === "cancelled") && !body.completed_at) {
    updates.push("completed_at = ?");
    values.push(now);

    // Calculate actual_time_minutes if started_at exists and not already set
    const startedAt = body.started_at || existing.started_at;
    if (startedAt && !body.actual_time_minutes) {
      const startedAtDate = new Date(startedAt);
      const completedAtDate = new Date(now);
      const actualMinutes = Math.round(
        (completedAtDate.getTime() - startedAtDate.getTime()) / 60000
      );
      updates.push("actual_time_minutes = ?");
      values.push(actualMinutes);
    }
  }

  if (updates.length === 0) {
    throw new ApiError("No updates provided", 400, "NO_UPDATES");
  }

  updates.push("updated_at = ?");
  values.push(now);

  values.push(taskId);
  values.push(tenantId);

  await c.env.DB.prepare(
    `UPDATE worklist_tasks SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
  )
    .bind(...values)
    .run();

  // Fetch updated task
  const task = await c.env.DB.prepare(
    "SELECT * FROM worklist_tasks WHERE id = ?"
  )
    .bind(taskId)
    .first<WorklistTask>();

  return c.json({
    success: true,
    data: task,
  });
};

// Register PUT and PATCH routes for update
worklist.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  updateTaskHandler
);

worklist.patch(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  updateTaskHandler
);

// =============================================================================
// UPDATE TASK STATUS
// =============================================================================

/**
 * PUT /api/v1/worklist/:id/status
 * Change task status (with automatic timestamp updates)
 */
worklist.put(
  "/:id/status",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists
    const existing = await c.env.DB.prepare(
      "SELECT id, status, started_at FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first<{ id: string; status: string; started_at: string | null }>();

    if (!existing) {
      throw new ApiError("Task not found", 404, "TASK_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateStatusSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateStatusSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();
    const updates: string[] = ["status = ?", "updated_at = ?"];
    const values: (string | null)[] = [body.status, now];

    // Set started_at when transitioning to in_progress
    if (body.status === "in_progress" && !existing.started_at) {
      updates.push("started_at = ?");
      values.push(now);
    }

    // Set completed_at when transitioning to completed or cancelled
    if (body.status === "completed" || body.status === "cancelled") {
      updates.push("completed_at = ?");
      values.push(now);

      // Calculate actual_time_minutes if started_at exists
      if (existing.started_at) {
        const startedAt = new Date(existing.started_at);
        const completedAt = new Date(now);
        const actualMinutes = Math.round(
          (completedAt.getTime() - startedAt.getTime()) / 60000
        );
        updates.push("actual_time_minutes = ?");
        values.push(actualMinutes.toString());
      }
    }

    values.push(taskId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE worklist_tasks SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated task
    const task = await c.env.DB.prepare(
      "SELECT * FROM worklist_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<WorklistTask>();

    return c.json({
      success: true,
      data: task,
    });
  }
);

// =============================================================================
// ASSIGN TASK
// =============================================================================

/**
 * PUT /api/v1/worklist/:id/assign
 * Assign or unassign a task to a user
 */
worklist.put(
  "/:id/assign",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Task not found", 404, "TASK_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof assignTaskSchema>;
    try {
      const rawBody = await c.req.json();
      body = assignTaskSchema.parse(rawBody);
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

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "UPDATE worklist_tasks SET assigned_to = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    )
      .bind(body.assigned_to, now, taskId, tenantId)
      .run();

    // Fetch updated task
    const task = await c.env.DB.prepare(
      "SELECT * FROM worklist_tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<WorklistTask>();

    return c.json({
      success: true,
      data: task,
    });
  }
);

// =============================================================================
// DELETE TASK
// =============================================================================

/**
 * DELETE /api/v1/worklist/:id
 * Delete a worklist task
 */
worklist.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const taskId = c.req.param("id");

    // Check task exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Task not found", 404, "TASK_NOT_FOUND");
    }

    // Delete the task
    await c.env.DB.prepare(
      "DELETE FROM worklist_tasks WHERE id = ? AND tenant_id = ?"
    )
      .bind(taskId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Task deleted successfully",
    });
  }
);
