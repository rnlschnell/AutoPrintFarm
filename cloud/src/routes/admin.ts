/**
 * Admin Routes - System Administration
 *
 * Provides administrative endpoints for:
 * - Dead Letter Queue management
 * - System health and diagnostics
 *
 * All routes require owner role.
 *
 * Phase 15: Background Queues
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import {
  listDLQMessages,
  getDLQMessage,
  deleteDLQMessage,
  purgeDLQMessages,
  requeueMessage,
} from "../lib/dlq";

export const admin = new Hono<HonoEnv>();

// =============================================================================
// DLQ ROUTES
// =============================================================================

/**
 * GET /api/v1/admin/dlq
 * List dead letter queue messages
 */
admin.get(
  "/dlq",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const queue = c.req.query("queue");
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
    const offset = (page - 1) * limit;

    const options: { tenantId: string; queue?: string; limit: number; offset: number } = {
      tenantId,
      limit,
      offset,
    };
    if (queue) {
      options.queue = queue;
    }
    const { messages, total } = await listDLQMessages(c.env, options);

    // Parse original_message JSON for response
    const parsed = messages.map((msg) => ({
      ...msg,
      original_message: safeParseJSON(msg.original_message),
    }));

    return c.json({
      success: true,
      data: parsed,
      meta: {
        page,
        limit,
        total,
        hasMore: offset + messages.length < total,
      },
    });
  }
);

/**
 * GET /api/v1/admin/dlq/stats
 * Get DLQ statistics
 */
admin.get(
  "/dlq/stats",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Get counts by queue
    const byQueue = await c.env.DB.prepare(
      `SELECT original_queue, COUNT(*) as count
       FROM dead_letter_messages
       WHERE tenant_id = ?
       GROUP BY original_queue`
    )
      .bind(tenantId)
      .all<{ original_queue: string; count: number }>();

    // Get total count
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM dead_letter_messages WHERE tenant_id = ?`
    )
      .bind(tenantId)
      .first<{ count: number }>();

    // Get oldest message
    const oldest = await c.env.DB.prepare(
      `SELECT failed_at FROM dead_letter_messages
       WHERE tenant_id = ?
       ORDER BY failed_at ASC
       LIMIT 1`
    )
      .bind(tenantId)
      .first<{ failed_at: string }>();

    // Get count by time period (last 24h, 7d, 30d)
    const now = Date.now();
    const periods = [
      { label: "last_24h", ms: 24 * 60 * 60 * 1000 },
      { label: "last_7d", ms: 7 * 24 * 60 * 60 * 1000 },
      { label: "last_30d", ms: 30 * 24 * 60 * 60 * 1000 },
    ];

    const byPeriod: Record<string, number> = {};
    for (const period of periods) {
      const since = new Date(now - period.ms).toISOString();
      const count = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM dead_letter_messages
         WHERE tenant_id = ? AND failed_at >= ?`
      )
        .bind(tenantId, since)
        .first<{ count: number }>();
      byPeriod[period.label] = count?.count || 0;
    }

    return c.json({
      success: true,
      data: {
        total: total?.count || 0,
        by_queue: byQueue.results || [],
        by_period: byPeriod,
        oldest_message: oldest?.failed_at || null,
      },
    });
  }
);

/**
 * GET /api/v1/admin/dlq/:id
 * Get a single DLQ message
 */
admin.get(
  "/dlq/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const message = await getDLQMessage(c.env, id, tenantId);

    if (!message) {
      throw new ApiError("DLQ message not found", 404, "NOT_FOUND");
    }

    return c.json({
      success: true,
      data: {
        ...message,
        original_message: safeParseJSON(message.original_message),
      },
    });
  }
);

/**
 * POST /api/v1/admin/dlq/:id/retry
 * Retry a DLQ message by requeuing it
 */
admin.post(
  "/dlq/:id/retry",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const result = await requeueMessage(c.env, id, tenantId);

    if (!result.success) {
      throw new ApiError(result.error || "Failed to retry message", 400, "RETRY_FAILED");
    }

    return c.json({
      success: true,
      message: "Message requeued successfully",
    });
  }
);

/**
 * DELETE /api/v1/admin/dlq/:id
 * Delete a single DLQ message
 */
admin.delete(
  "/dlq/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const id = c.req.param("id");

    const deleted = await deleteDLQMessage(c.env, id, tenantId);

    if (!deleted) {
      throw new ApiError("DLQ message not found", 404, "NOT_FOUND");
    }

    return c.json({
      success: true,
      message: "Message deleted successfully",
    });
  }
);

/**
 * POST /api/v1/admin/dlq/purge
 * Purge multiple DLQ messages
 */
admin.post(
  "/dlq/purge",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner"]), // Only owner can purge
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse request body
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
      queue: z.string().optional(),
      older_than_days: z.number().int().min(0).optional(),
      confirm: z.boolean(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    if (!parsed.data.confirm) {
      throw new ApiError(
        "Please confirm the purge operation by setting confirm: true",
        400,
        "CONFIRMATION_REQUIRED"
      );
    }

    // Calculate older_than timestamp if provided
    let olderThan: string | undefined;
    if (parsed.data.older_than_days !== undefined) {
      const daysMs = parsed.data.older_than_days * 24 * 60 * 60 * 1000;
      olderThan = new Date(Date.now() - daysMs).toISOString();
    }

    const purgeOptions: { tenantId: string; queue?: string; olderThan?: string } = {
      tenantId,
    };
    if (parsed.data.queue) {
      purgeOptions.queue = parsed.data.queue;
    }
    if (olderThan) {
      purgeOptions.olderThan = olderThan;
    }
    const deleted = await purgeDLQMessages(c.env, purgeOptions);

    return c.json({
      success: true,
      message: `Purged ${deleted} message(s)`,
      deleted_count: deleted,
    });
  }
);

/**
 * POST /api/v1/admin/dlq/retry-all
 * Retry all messages in DLQ (optionally filtered by queue)
 */
admin.post(
  "/dlq/retry-all",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
      queue: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Get messages to retry
    const retryOptions: { tenantId: string; queue?: string; limit: number } = {
      tenantId,
      limit: parsed.data.limit,
    };
    if (parsed.data.queue) {
      retryOptions.queue = parsed.data.queue;
    }
    const { messages } = await listDLQMessages(c.env, retryOptions);

    let succeeded = 0;
    let failed = 0;
    const errors: { id: string; error: string }[] = [];

    for (const message of messages) {
      const result = await requeueMessage(c.env, message.id, tenantId);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
        errors.push({ id: message.id, error: result.error || "Unknown error" });
      }
    }

    return c.json({
      success: true,
      message: `Retried ${succeeded} message(s), ${failed} failed`,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  }
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Safely parse JSON, returning the original string if parsing fails
 */
function safeParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
