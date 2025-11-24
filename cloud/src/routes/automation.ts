/**
 * Automation Routes - Automation Rules Management
 *
 * CRUD operations for automation rules with event triggers and actions.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { paginate, getCount, now } from "../lib/db";
import type { AutomationRule, AutomationTriggerType, AutomationActionType } from "../types";

export const automation = new Hono<HonoEnv>();

// =============================================================================
// CONSTANTS
// =============================================================================

const TRIGGER_TYPES: AutomationTriggerType[] = [
  "print_completed",
  "print_failed",
  "print_started",
  "printer_offline",
  "printer_online",
  "printer_error",
  "low_stock",
  "order_received",
  "order_fulfilled",
  "assembly_completed",
  "task_completed",
  "hub_offline",
  "hub_online",
  "schedule",
];

const ACTION_TYPES: AutomationActionType[] = [
  "send_notification",
  "send_email",
  "send_webhook",
  "create_task",
  "update_status",
  "assign_printer",
  "start_next_job",
  "pause_queue",
  "resume_queue",
  "update_inventory",
  "create_order_item",
  "run_script",
];

// =============================================================================
// SCHEMAS
// =============================================================================

const createAutomationSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  trigger_type: z.enum(TRIGGER_TYPES as [AutomationTriggerType, ...AutomationTriggerType[]]),
  trigger_conditions: z.record(z.unknown()).optional(), // JSON object for conditions
  action_type: z.enum(ACTION_TYPES as [AutomationActionType, ...AutomationActionType[]]),
  action_config: z.record(z.unknown()).optional(), // JSON object for action configuration
  printer_ids: z.array(z.string()).optional(), // Target specific printers
  product_ids: z.array(z.string()).optional(), // Target specific products
  schedule_cron: z.string().max(100).optional(), // Cron expression for schedule trigger
  schedule_timezone: z.string().max(50).default("UTC"),
  is_enabled: z.boolean().default(true),
  cooldown_seconds: z.number().int().min(0).max(86400).default(0), // Max 24 hours
  max_triggers_per_hour: z.number().int().min(1).max(1000).optional(),
});

const updateAutomationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  trigger_type: z.enum(TRIGGER_TYPES as [AutomationTriggerType, ...AutomationTriggerType[]]).optional(),
  trigger_conditions: z.record(z.unknown()).nullable().optional(),
  action_type: z.enum(ACTION_TYPES as [AutomationActionType, ...AutomationActionType[]]).optional(),
  action_config: z.record(z.unknown()).nullable().optional(),
  printer_ids: z.array(z.string()).nullable().optional(),
  product_ids: z.array(z.string()).nullable().optional(),
  schedule_cron: z.string().max(100).nullable().optional(),
  schedule_timezone: z.string().max(50).optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  max_triggers_per_hour: z.number().int().min(1).max(1000).nullable().optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse JSON fields and return a clean automation rule object
 */
function parseAutomationRule(rule: AutomationRule): AutomationRule & {
  trigger_conditions: Record<string, unknown> | null;
  action_config: Record<string, unknown> | null;
  printer_ids: string[] | null;
  product_ids: string[] | null;
} {
  return {
    ...rule,
    trigger_conditions: rule.trigger_conditions
      ? JSON.parse(rule.trigger_conditions as unknown as string)
      : null,
    action_config: rule.action_config
      ? JSON.parse(rule.action_config as unknown as string)
      : null,
    printer_ids: rule.printer_ids
      ? JSON.parse(rule.printer_ids as unknown as string)
      : null,
    product_ids: rule.product_ids
      ? JSON.parse(rule.product_ids as unknown as string)
      : null,
  };
}

// =============================================================================
// LIST TRIGGER TYPES
// =============================================================================

/**
 * GET /api/v1/automation/trigger-types
 * Get list of available trigger types
 */
automation.get("/trigger-types", requireAuth(), requireTenant(), async (c) => {
  const triggerTypeDescriptions: Record<AutomationTriggerType, string> = {
    print_completed: "Triggered when a print job completes successfully",
    print_failed: "Triggered when a print job fails",
    print_started: "Triggered when a print job starts",
    printer_offline: "Triggered when a printer goes offline",
    printer_online: "Triggered when a printer comes online",
    printer_error: "Triggered when a printer reports an error",
    low_stock: "Triggered when inventory falls below threshold",
    order_received: "Triggered when a new order is received",
    order_fulfilled: "Triggered when an order is fulfilled",
    assembly_completed: "Triggered when an assembly task is completed",
    task_completed: "Triggered when a worklist task is completed",
    hub_offline: "Triggered when a hub goes offline",
    hub_online: "Triggered when a hub comes online",
    schedule: "Triggered on a schedule (cron expression)",
  };

  return c.json({
    success: true,
    data: TRIGGER_TYPES.map((type) => ({
      type,
      description: triggerTypeDescriptions[type],
    })),
  });
});

// =============================================================================
// LIST ACTION TYPES
// =============================================================================

/**
 * GET /api/v1/automation/action-types
 * Get list of available action types
 */
automation.get("/action-types", requireAuth(), requireTenant(), async (c) => {
  const actionTypeDescriptions: Record<AutomationActionType, string> = {
    send_notification: "Send a push notification",
    send_email: "Send an email notification",
    send_webhook: "Send a webhook to an external URL",
    create_task: "Create a worklist task",
    update_status: "Update the status of a resource",
    assign_printer: "Assign a job to a specific printer",
    start_next_job: "Start the next job in the queue",
    pause_queue: "Pause the print queue",
    resume_queue: "Resume the print queue",
    update_inventory: "Update inventory levels",
    create_order_item: "Create an order item",
    run_script: "Run a custom script",
  };

  return c.json({
    success: true,
    data: ACTION_TYPES.map((type) => ({
      type,
      description: actionTypeDescriptions[type],
    })),
  });
});

// =============================================================================
// LIST AUTOMATION RULES
// =============================================================================

/**
 * GET /api/v1/automation
 * List all automation rules for the current tenant
 * Supports filtering by trigger_type, action_type, is_enabled
 * Supports pagination
 */
automation.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const triggerType = c.req.query("trigger_type");
  const actionType = c.req.query("action_type");
  const isEnabled = c.req.query("is_enabled");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (triggerType) {
    whereClause += " AND trigger_type = ?";
    params.push(triggerType);
  }

  if (actionType) {
    whereClause += " AND action_type = ?";
    params.push(actionType);
  }

  if (isEnabled !== undefined) {
    whereClause += " AND is_enabled = ?";
    params.push(isEnabled === "true" ? 1 : 0);
  }

  // Get total count
  const total = await getCount(c.env.DB, "automation_rules", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query rules
  const query = `
    SELECT * FROM automation_rules
    WHERE ${whereClause}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<AutomationRule>();

  // Parse JSON fields
  const rules = (result.results || []).map(parseAutomationRule);

  return c.json({
    success: true,
    data: rules,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: offset + (result.results?.length || 0) < total,
    },
  });
});

// =============================================================================
// GET SINGLE AUTOMATION RULE
// =============================================================================

/**
 * GET /api/v1/automation/:id
 * Get a single automation rule by ID
 */
automation.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const ruleId = c.req.param("id");

  const rule = await c.env.DB.prepare(
    "SELECT * FROM automation_rules WHERE id = ? AND tenant_id = ?"
  )
    .bind(ruleId, tenantId)
    .first<AutomationRule>();

  if (!rule) {
    throw new ApiError("Automation rule not found", 404, "RULE_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: parseAutomationRule(rule),
  });
});

// =============================================================================
// CREATE AUTOMATION RULE
// =============================================================================

/**
 * POST /api/v1/automation
 * Create a new automation rule
 */
automation.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createAutomationSchema>;
    try {
      const rawBody = await c.req.json();
      body = createAutomationSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate schedule_cron if trigger_type is 'schedule'
    if (body.trigger_type === "schedule" && !body.schedule_cron) {
      throw new ApiError(
        "schedule_cron is required for schedule trigger type",
        400,
        "MISSING_CRON"
      );
    }

    // Validate printer_ids if provided
    if (body.printer_ids && body.printer_ids.length > 0) {
      const placeholders = body.printer_ids.map(() => "?").join(",");
      const printers = await c.env.DB.prepare(
        `SELECT id FROM printers WHERE id IN (${placeholders}) AND tenant_id = ?`
      )
        .bind(...body.printer_ids, tenantId)
        .all<{ id: string }>();

      if ((printers.results?.length || 0) !== body.printer_ids.length) {
        throw new ApiError(
          "One or more printer IDs are invalid",
          400,
          "INVALID_PRINTER_IDS"
        );
      }
    }

    // Validate product_ids if provided
    if (body.product_ids && body.product_ids.length > 0) {
      const placeholders = body.product_ids.map(() => "?").join(",");
      const products = await c.env.DB.prepare(
        `SELECT id FROM products WHERE id IN (${placeholders}) AND tenant_id = ?`
      )
        .bind(...body.product_ids, tenantId)
        .all<{ id: string }>();

      if ((products.results?.length || 0) !== body.product_ids.length) {
        throw new ApiError(
          "One or more product IDs are invalid",
          400,
          "INVALID_PRODUCT_IDS"
        );
      }
    }

    const ruleId = generateId();
    const timestamp = now();

    await c.env.DB.prepare(
      `INSERT INTO automation_rules (
        id, tenant_id, name, description,
        trigger_type, trigger_conditions,
        action_type, action_config,
        printer_ids, product_ids,
        schedule_cron, schedule_timezone,
        is_enabled, trigger_count,
        cooldown_seconds, max_triggers_per_hour,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
      .bind(
        ruleId,
        tenantId,
        body.name,
        body.description || null,
        body.trigger_type,
        body.trigger_conditions ? JSON.stringify(body.trigger_conditions) : null,
        body.action_type,
        body.action_config ? JSON.stringify(body.action_config) : null,
        body.printer_ids ? JSON.stringify(body.printer_ids) : null,
        body.product_ids ? JSON.stringify(body.product_ids) : null,
        body.schedule_cron || null,
        body.schedule_timezone,
        body.is_enabled ? 1 : 0,
        body.cooldown_seconds,
        body.max_triggers_per_hour || null,
        timestamp,
        timestamp
      )
      .run();

    // Fetch the created rule
    const rule = await c.env.DB.prepare(
      "SELECT * FROM automation_rules WHERE id = ?"
    )
      .bind(ruleId)
      .first<AutomationRule>();

    return c.json(
      {
        success: true,
        data: parseAutomationRule(rule!),
      },
      201
    );
  }
);

// =============================================================================
// UPDATE AUTOMATION RULE
// =============================================================================

/**
 * PUT /api/v1/automation/:id
 * Update an automation rule
 */
automation.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const ruleId = c.req.param("id");

    // Check rule exists
    const existing = await c.env.DB.prepare(
      "SELECT id, trigger_type FROM automation_rules WHERE id = ? AND tenant_id = ?"
    )
      .bind(ruleId, tenantId)
      .first<{ id: string; trigger_type: string }>();

    if (!existing) {
      throw new ApiError("Automation rule not found", 404, "RULE_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateAutomationSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateAutomationSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate schedule_cron if trigger_type is/becomes 'schedule'
    const newTriggerType = body.trigger_type || existing.trigger_type;
    if (newTriggerType === "schedule" && body.schedule_cron === null) {
      throw new ApiError(
        "schedule_cron cannot be null for schedule trigger type",
        400,
        "MISSING_CRON"
      );
    }

    // Validate printer_ids if provided
    if (body.printer_ids && body.printer_ids.length > 0) {
      const placeholders = body.printer_ids.map(() => "?").join(",");
      const printers = await c.env.DB.prepare(
        `SELECT id FROM printers WHERE id IN (${placeholders}) AND tenant_id = ?`
      )
        .bind(...body.printer_ids, tenantId)
        .all<{ id: string }>();

      if ((printers.results?.length || 0) !== body.printer_ids.length) {
        throw new ApiError(
          "One or more printer IDs are invalid",
          400,
          "INVALID_PRINTER_IDS"
        );
      }
    }

    // Validate product_ids if provided
    if (body.product_ids && body.product_ids.length > 0) {
      const placeholders = body.product_ids.map(() => "?").join(",");
      const products = await c.env.DB.prepare(
        `SELECT id FROM products WHERE id IN (${placeholders}) AND tenant_id = ?`
      )
        .bind(...body.product_ids, tenantId)
        .all<{ id: string }>();

      if ((products.results?.length || 0) !== body.product_ids.length) {
        throw new ApiError(
          "One or more product IDs are invalid",
          400,
          "INVALID_PRODUCT_IDS"
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
      { key: "name", column: "name" },
      { key: "description", column: "description" },
      { key: "trigger_type", column: "trigger_type" },
      {
        key: "trigger_conditions",
        column: "trigger_conditions",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      { key: "action_type", column: "action_type" },
      {
        key: "action_config",
        column: "action_config",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      {
        key: "printer_ids",
        column: "printer_ids",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      {
        key: "product_ids",
        column: "product_ids",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      { key: "schedule_cron", column: "schedule_cron" },
      { key: "schedule_timezone", column: "schedule_timezone" },
      { key: "cooldown_seconds", column: "cooldown_seconds" },
      { key: "max_triggers_per_hour", column: "max_triggers_per_hour" },
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
    values.push(now());

    values.push(ruleId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE automation_rules SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated rule
    const rule = await c.env.DB.prepare(
      "SELECT * FROM automation_rules WHERE id = ?"
    )
      .bind(ruleId)
      .first<AutomationRule>();

    return c.json({
      success: true,
      data: parseAutomationRule(rule!),
    });
  }
);

// =============================================================================
// TOGGLE AUTOMATION RULE
// =============================================================================

/**
 * PUT /api/v1/automation/:id/toggle
 * Enable or disable an automation rule
 */
automation.put(
  "/:id/toggle",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const ruleId = c.req.param("id");

    // Check rule exists
    const existing = await c.env.DB.prepare(
      "SELECT id, is_enabled FROM automation_rules WHERE id = ? AND tenant_id = ?"
    )
      .bind(ruleId, tenantId)
      .first<{ id: string; is_enabled: number }>();

    if (!existing) {
      throw new ApiError("Automation rule not found", 404, "RULE_NOT_FOUND");
    }

    // Toggle the is_enabled state
    const newState = existing.is_enabled === 1 ? 0 : 1;

    await c.env.DB.prepare(
      "UPDATE automation_rules SET is_enabled = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    )
      .bind(newState, now(), ruleId, tenantId)
      .run();

    // Fetch updated rule
    const rule = await c.env.DB.prepare(
      "SELECT * FROM automation_rules WHERE id = ?"
    )
      .bind(ruleId)
      .first<AutomationRule>();

    return c.json({
      success: true,
      data: parseAutomationRule(rule!),
      message: newState === 1 ? "Rule enabled" : "Rule disabled",
    });
  }
);

// =============================================================================
// DELETE AUTOMATION RULE
// =============================================================================

/**
 * DELETE /api/v1/automation/:id
 * Delete an automation rule
 */
automation.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const ruleId = c.req.param("id");

    // Check rule exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM automation_rules WHERE id = ? AND tenant_id = ?"
    )
      .bind(ruleId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Automation rule not found", 404, "RULE_NOT_FOUND");
    }

    await c.env.DB.prepare(
      "DELETE FROM automation_rules WHERE id = ? AND tenant_id = ?"
    )
      .bind(ruleId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Automation rule deleted successfully",
    });
  }
);
