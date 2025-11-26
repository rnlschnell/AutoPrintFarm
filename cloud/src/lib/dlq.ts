/**
 * Dead Letter Queue Helper
 *
 * Provides utilities for sending failed messages to the dead letter queue
 * and managing DLQ entries.
 *
 * Phase 15: Background Queues
 */

import type { Env } from "../types/env";
import { generateId } from "./crypto";
import { now } from "./db";

// =============================================================================
// TYPES
// =============================================================================

export interface DeadLetterMessage {
  originalQueue: string;
  originalMessage: unknown;
  error: string;
  stackTrace?: string;
  attempts: number;
  failedAt: string;
  tenantId?: string;
}

export interface DeadLetterRecord {
  id: string;
  tenant_id: string | null;
  original_queue: string;
  original_message: string;
  error_message: string | null;
  stack_trace: string | null;
  attempts: number;
  failed_at: string;
  retried_at: string | null;
  retry_count: number;
  created_at: string;
}

// =============================================================================
// SEND TO DLQ
// =============================================================================

/**
 * Send a failed message to the dead letter queue
 *
 * @param env - Environment bindings
 * @param queueName - Name of the original queue
 * @param message - The original message that failed
 * @param error - The error that caused the failure
 * @param attempts - Number of processing attempts made
 * @param tenantId - Optional tenant ID for filtering
 */
export async function sendToDeadLetter(
  env: Env,
  queueName: string,
  message: unknown,
  error: Error | string,
  attempts: number,
  tenantId?: string
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stackTrace = error instanceof Error ? error.stack : undefined;

  const dlqMessage: DeadLetterMessage = {
    originalQueue: queueName,
    originalMessage: message,
    error: errorMessage,
    ...(stackTrace && { stackTrace }),
    attempts,
    failedAt: now(),
    ...(tenantId && { tenantId }),
  };

  try {
    // Send to the dead letter queue for processing
    await env.DEAD_LETTER.send(dlqMessage);
    console.log(
      `Sent message to DLQ: queue=${queueName}, tenant=${tenantId || "none"}, error=${errorMessage}`
    );
  } catch (dlqError) {
    // If DLQ send fails, log it but don't throw - we don't want to lose the error context
    console.error("Failed to send message to DLQ:", dlqError);
    console.error("Original error:", errorMessage);
    console.error("Original message:", JSON.stringify(message));
  }
}

// =============================================================================
// DLQ RECORD MANAGEMENT
// =============================================================================

/**
 * Store a DLQ message in the database for inspection
 */
export async function storeDLQMessage(
  env: Env,
  message: DeadLetterMessage
): Promise<string> {
  const id = generateId();
  const timestamp = now();

  await env.DB.prepare(
    `INSERT INTO dead_letter_messages (
      id, tenant_id, original_queue, original_message,
      error_message, stack_trace, attempts,
      failed_at, retry_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  )
    .bind(
      id,
      message.tenantId || null,
      message.originalQueue,
      JSON.stringify(message.originalMessage),
      message.error,
      message.stackTrace || null,
      message.attempts,
      message.failedAt,
      timestamp
    )
    .run();

  return id;
}

/**
 * List DLQ messages with optional filtering
 */
export async function listDLQMessages(
  env: Env,
  options: {
    tenantId?: string;
    queue?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ messages: DeadLetterRecord[]; total: number }> {
  const { tenantId, queue, limit = 50, offset = 0 } = options;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (tenantId) {
    conditions.push("tenant_id = ?");
    params.push(tenantId);
  }

  if (queue) {
    conditions.push("original_queue = ?");
    params.push(queue);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count
  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM dead_letter_messages ${whereClause}`
  )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count || 0;

  // Get messages
  const result = await env.DB.prepare(
    `SELECT * FROM dead_letter_messages ${whereClause}
     ORDER BY failed_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<DeadLetterRecord>();

  return {
    messages: result.results || [],
    total,
  };
}

/**
 * Get a single DLQ message by ID
 */
export async function getDLQMessage(
  env: Env,
  id: string,
  tenantId?: string
): Promise<DeadLetterRecord | null> {
  let query = "SELECT * FROM dead_letter_messages WHERE id = ?";
  const params: string[] = [id];

  if (tenantId) {
    query += " AND tenant_id = ?";
    params.push(tenantId);
  }

  return await env.DB.prepare(query).bind(...params).first<DeadLetterRecord>();
}

/**
 * Delete a DLQ message
 */
export async function deleteDLQMessage(
  env: Env,
  id: string,
  tenantId?: string
): Promise<boolean> {
  let query = "DELETE FROM dead_letter_messages WHERE id = ?";
  const params: string[] = [id];

  if (tenantId) {
    query += " AND tenant_id = ?";
    params.push(tenantId);
  }

  const result = await env.DB.prepare(query).bind(...params).run();
  return (result.meta?.changes || 0) > 0;
}

/**
 * Purge all DLQ messages (optionally filtered)
 */
export async function purgeDLQMessages(
  env: Env,
  options: {
    tenantId?: string;
    queue?: string;
    olderThan?: string; // ISO timestamp
  } = {}
): Promise<number> {
  const { tenantId, queue, olderThan } = options;

  const conditions: string[] = [];
  const params: string[] = [];

  if (tenantId) {
    conditions.push("tenant_id = ?");
    params.push(tenantId);
  }

  if (queue) {
    conditions.push("original_queue = ?");
    params.push(queue);
  }

  if (olderThan) {
    conditions.push("failed_at < ?");
    params.push(olderThan);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await env.DB.prepare(
    `DELETE FROM dead_letter_messages ${whereClause}`
  )
    .bind(...params)
    .run();

  return result.meta?.changes || 0;
}

/**
 * Mark a message as retried and update retry count
 */
export async function markAsRetried(
  env: Env,
  id: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE dead_letter_messages
     SET retried_at = ?, retry_count = retry_count + 1
     WHERE id = ?`
  )
    .bind(now(), id)
    .run();
}

// =============================================================================
// REQUEUE HELPERS
// =============================================================================

/**
 * Requeue a DLQ message back to its original queue
 */
export async function requeueMessage(
  env: Env,
  id: string,
  tenantId?: string
): Promise<{ success: boolean; error?: string }> {
  // Get the DLQ message
  const message = await getDLQMessage(env, id, tenantId);

  if (!message) {
    return { success: false, error: "Message not found" };
  }

  // Parse the original message
  let originalMessage: unknown;
  try {
    originalMessage = JSON.parse(message.original_message);
  } catch {
    return { success: false, error: "Failed to parse original message" };
  }

  // Determine which queue to send to
  const queueName = message.original_queue;

  try {
    // Route to the appropriate queue
    // Note: We cast to 'unknown' first to satisfy TypeScript since we're
    // re-sending the original message which was stored as JSON
    switch (queueName) {
      case "print-events":
        await env.PRINT_EVENTS.send(originalMessage as Parameters<typeof env.PRINT_EVENTS.send>[0]);
        break;
      case "file-processing":
        await env.FILE_PROCESSING.send(originalMessage as Parameters<typeof env.FILE_PROCESSING.send>[0]);
        break;
      case "notifications":
        await env.NOTIFICATIONS.send(originalMessage as Parameters<typeof env.NOTIFICATIONS.send>[0]);
        break;
      case "shopify-sync":
        await env.SHOPIFY_SYNC.send(originalMessage as Parameters<typeof env.SHOPIFY_SYNC.send>[0]);
        break;
      default:
        return { success: false, error: `Unknown queue: ${queueName}` };
    }

    // Mark as retried
    await markAsRetried(env, id);

    // Optionally delete the DLQ message after successful requeue
    // await deleteDLQMessage(env, id, tenantId);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to requeue: ${errorMessage}` };
  }
}
