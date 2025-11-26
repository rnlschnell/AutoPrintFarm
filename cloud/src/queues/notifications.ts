/**
 * Notifications Queue Consumer
 *
 * Handles notification delivery for email, webhooks, and push notifications.
 * Email is logged but not sent (provider configuration deferred).
 *
 * Phase 15: Background Queues
 */

import type { Env, NotificationMessage } from "../types/env";
import { sendToDeadLetter } from "../lib/dlq";
import { generateHMAC } from "../lib/crypto";

// =============================================================================
// TYPES
// =============================================================================

interface EmailPayload {
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

interface WebhookPayload {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  secret?: string; // For HMAC signing
  timeout?: number;
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  icon?: string;
  badge?: string;
}

// =============================================================================
// QUEUE HANDLER
// =============================================================================

/**
 * Main queue handler for notifications
 */
export async function handleNotificationsQueue(
  batch: MessageBatch<NotificationMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processNotification(message.body, env);
      message.ack();
    } catch (error) {
      console.error(
        `Error processing notification ${message.body.type}:`,
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
          "notifications",
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
 * Route notification to appropriate handler
 */
async function processNotification(
  notification: NotificationMessage,
  _env: Env
): Promise<void> {
  console.log(
    `Processing notification: type=${notification.type}, tenant=${notification.tenantId}`
  );

  switch (notification.type) {
    case "email":
      await handleEmailNotification(notification.payload as unknown as EmailPayload, notification.tenantId);
      break;

    case "webhook":
      await handleWebhookNotification(notification.payload as unknown as WebhookPayload, notification.tenantId);
      break;

    case "push":
      await handlePushNotification(notification.payload as unknown as PushPayload, notification.tenantId);
      break;

    default:
      console.warn(`Unknown notification type: ${(notification as NotificationMessage).type}`);
  }
}

// =============================================================================
// EMAIL HANDLER
// =============================================================================

/**
 * Handle email notification
 * Currently logs but does not send - provider configuration deferred
 */
async function handleEmailNotification(
  payload: EmailPayload,
  tenantId: string
): Promise<void> {
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  console.log(`[EMAIL] Would send email notification:`);
  console.log(`  Tenant: ${tenantId}`);
  console.log(`  To: ${recipients.join(", ")}`);
  console.log(`  Subject: ${payload.subject}`);
  console.log(`  Body: ${payload.body?.substring(0, 100)}${payload.body?.length > 100 ? "..." : ""}`);

  if (payload.from) {
    console.log(`  From: ${payload.from}`);
  }

  // TODO: When email provider is configured, send the actual email here
  // Example with Resend:
  // await resend.emails.send({
  //   from: payload.from || 'notifications@printfarm.app',
  //   to: recipients,
  //   subject: payload.subject,
  //   text: payload.body,
  //   html: payload.html,
  // });

  console.log(`[EMAIL] Email logged successfully (sending disabled)`);
}

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

/**
 * Handle webhook notification
 */
async function handleWebhookNotification(
  payload: WebhookPayload,
  tenantId: string
): Promise<void> {
  const {
    url,
    method = "POST",
    headers = {},
    body,
    secret,
    timeout = 10000,
  } = payload;

  // Validate URL
  if (!url || !url.startsWith("http")) {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  console.log(`[WEBHOOK] Sending webhook: ${method} ${url}`);

  // Prepare request body
  const bodyString = body ? JSON.stringify(body) : undefined;

  // Build headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "PrintFarm-Webhook/1.0",
    "X-Tenant-ID": tenantId,
    ...headers,
  };

  // Add HMAC signature if secret is provided
  if (secret && bodyString) {
    const signature = await generateHMAC(secret, bodyString);
    requestHeaders["X-Webhook-Signature"] = `sha256=${signature}`;
    requestHeaders["X-Webhook-Timestamp"] = String(Date.now());
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: bodyString ?? null,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(`[WEBHOOK] Response: ${response.status} ${response.statusText}`);

    // Treat 5xx as retriable errors
    if (response.status >= 500) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Webhook returned ${response.status}: ${errorBody.substring(0, 200)}`
      );
    }

    // Log non-2xx responses but don't retry
    if (!response.ok) {
      console.warn(`[WEBHOOK] Non-success response: ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Webhook timed out after ${timeout}ms`);
    }

    throw error;
  }
}

// =============================================================================
// PUSH HANDLER
// =============================================================================

/**
 * Handle push notification
 * Currently a placeholder for future web push implementation
 */
async function handlePushNotification(
  payload: PushPayload,
  tenantId: string
): Promise<void> {
  console.log(`[PUSH] Would send push notification:`);
  console.log(`  Tenant: ${tenantId}`);
  console.log(`  Title: ${payload.title}`);
  console.log(`  Body: ${payload.body}`);

  if (payload.data) {
    console.log(`  Data: ${JSON.stringify(payload.data)}`);
  }

  // TODO: Implement web push when subscription management is added
  // This would involve:
  // 1. Looking up user push subscriptions from D1
  // 2. Sending to web push endpoints
  // 3. Handling subscription expiry/removal

  console.log(`[PUSH] Push notification logged (not implemented)`);
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  async queue(batch: MessageBatch<NotificationMessage>, env: Env): Promise<void> {
    await handleNotificationsQueue(batch, env);
  },
};
