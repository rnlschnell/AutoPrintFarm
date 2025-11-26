/**
 * Dead Letter Queue Consumer
 *
 * Handles messages that have failed processing in other queues.
 * Stores them in D1 for inspection and manual retry.
 *
 * Phase 15: Background Queues
 */

import type { Env } from "../types/env";
import { storeDLQMessage, type DeadLetterMessage } from "../lib/dlq";

// =============================================================================
// QUEUE HANDLER
// =============================================================================

/**
 * Main queue handler for dead letter messages
 */
export async function handleDeadLetterQueue(
  batch: MessageBatch<DeadLetterMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processDeadLetterMessage(message.body, env);
      message.ack();
    } catch (error) {
      console.error("Error processing dead letter message:", error);

      // For the DLQ itself, we don't retry infinitely - just log and ack
      // This prevents a recursive DLQ situation
      if (message.attempts >= 2) {
        console.error(
          "DLQ processing failed after multiple attempts, discarding:",
          JSON.stringify(message.body)
        );
        message.ack();
      } else {
        // One retry attempt with short delay
        message.retry({ delaySeconds: 5 });
      }
    }
  }
}

/**
 * Process a single dead letter message
 */
async function processDeadLetterMessage(
  message: DeadLetterMessage,
  env: Env
): Promise<void> {
  console.log(
    `Processing DLQ message: queue=${message.originalQueue}, tenant=${message.tenantId || "none"}`
  );

  // Store the message in D1 for inspection
  const id = await storeDLQMessage(env, message);

  console.log(`Stored DLQ message with ID: ${id}`);

  // Log details for debugging
  console.log(`  Original queue: ${message.originalQueue}`);
  console.log(`  Attempts: ${message.attempts}`);
  console.log(`  Error: ${message.error}`);
  console.log(`  Failed at: ${message.failedAt}`);

  // In the future, this could:
  // - Send notifications to admins
  // - Update metrics/analytics
  // - Trigger alerts based on error patterns
}

// Export default for compatibility with older patterns
export default {
  async queue(batch: MessageBatch<DeadLetterMessage>, env: Env): Promise<void> {
    await handleDeadLetterQueue(batch, env);
  },
};
