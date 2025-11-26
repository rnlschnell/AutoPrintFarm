/**
 * Automation Rule Engine
 *
 * Evaluates and executes automation rules triggered by system events.
 * Supports condition evaluation, rate limiting, and various action types.
 *
 * Phase 15: Background Queues
 */

import type { Env, NotificationMessage } from "../types/env";
import type { AutomationRule, AutomationTriggerType } from "../types";
import { generateId } from "./crypto";
import { now } from "./db";

// =============================================================================
// TYPES
// =============================================================================

export interface AutomationContext {
  // Common context fields
  jobId?: string;
  printerId?: string;
  productSkuId?: string;
  hubId?: string;
  orderId?: string;
  taskId?: string;

  // Event-specific data
  quantity?: number;
  fileName?: string;
  failureReason?: string;
  progressAtFailure?: number;
  currentStock?: number;
  threshold?: number;

  // Allow arbitrary additional context
  [key: string]: unknown;
}

interface ParsedAutomationRule extends Omit<AutomationRule, "trigger_conditions" | "action_config" | "printer_ids" | "product_ids"> {
  trigger_conditions: Record<string, unknown> | null;
  action_config: Record<string, unknown> | null;
  printer_ids: string[] | null;
  product_ids: string[] | null;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Trigger automation rules for a given event type
 *
 * @param env - Environment bindings
 * @param tenantId - Tenant ID
 * @param triggerType - The type of event that occurred
 * @param context - Event context data
 */
export async function triggerAutomationRules(
  env: Env,
  tenantId: string,
  triggerType: AutomationTriggerType,
  context: AutomationContext
): Promise<void> {
  try {
    // Find all matching rules
    const rules = await findMatchingRules(env, tenantId, triggerType, context);

    if (rules.length === 0) {
      return;
    }

    console.log(`Found ${rules.length} automation rules for trigger: ${triggerType}`);

    // Execute each matching rule
    for (const rule of rules) {
      try {
        // Check rate limits
        const canExecute = await checkRateLimits(env, rule);
        if (!canExecute) {
          console.log(`Rule ${rule.id} skipped due to rate limits`);
          continue;
        }

        // Execute the action
        await executeAction(env, rule, context);

        // Update trigger count and last triggered time
        await updateRuleTriggerStats(env, rule.id);

        console.log(`Executed automation rule: ${rule.name} (${rule.id})`);
      } catch (error) {
        console.error(`Error executing automation rule ${rule.id}:`, error);
        // Continue with other rules even if one fails
      }
    }
  } catch (error) {
    console.error(`Error triggering automation rules for ${triggerType}:`, error);
    // Don't throw - automation failures shouldn't break the main flow
  }
}

// =============================================================================
// RULE MATCHING
// =============================================================================

/**
 * Find all enabled rules that match the trigger type and conditions
 */
async function findMatchingRules(
  env: Env,
  tenantId: string,
  triggerType: AutomationTriggerType,
  context: AutomationContext
): Promise<ParsedAutomationRule[]> {
  // Query for enabled rules matching the trigger type
  const result = await env.DB.prepare(
    `SELECT * FROM automation_rules
     WHERE tenant_id = ? AND trigger_type = ? AND is_enabled = 1`
  )
    .bind(tenantId, triggerType)
    .all<AutomationRule>();

  const rules = result.results || [];

  // Filter by conditions and scope
  const matchingRules: ParsedAutomationRule[] = [];

  for (const rule of rules) {
    const parsed = parseRule(rule);

    // Check printer scope
    if (parsed.printer_ids && parsed.printer_ids.length > 0 && context.printerId) {
      if (!parsed.printer_ids.includes(context.printerId)) {
        continue;
      }
    }

    // Check product scope
    if (parsed.product_ids && parsed.product_ids.length > 0 && context.productSkuId) {
      // Get the product ID for this SKU
      const sku = await env.DB.prepare(
        "SELECT product_id FROM product_skus WHERE id = ?"
      )
        .bind(context.productSkuId)
        .first<{ product_id: string }>();

      if (sku && !parsed.product_ids.includes(sku.product_id)) {
        continue;
      }
    }

    // Check trigger conditions
    if (!evaluateConditions(parsed.trigger_conditions, context)) {
      continue;
    }

    matchingRules.push(parsed);
  }

  return matchingRules;
}

/**
 * Parse JSON fields in automation rule
 */
function parseRule(rule: AutomationRule): ParsedAutomationRule {
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
// CONDITION EVALUATION
// =============================================================================

/**
 * Evaluate if conditions match the event context
 *
 * Supports operators:
 * - eq: equals
 * - ne: not equals
 * - gt: greater than
 * - gte: greater than or equal
 * - lt: less than
 * - lte: less than or equal
 * - contains: string contains
 * - in: value in array
 */
function evaluateConditions(
  conditions: Record<string, unknown> | null,
  context: AutomationContext
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true; // No conditions = always match
  }

  for (const [key, condition] of Object.entries(conditions)) {
    const contextValue = context[key];

    // Handle simple equality
    if (typeof condition !== "object" || condition === null) {
      if (contextValue !== condition) {
        return false;
      }
      continue;
    }

    // Handle operator-based conditions
    const condObj = condition as Record<string, unknown>;

    if ("eq" in condObj && contextValue !== condObj.eq) {
      return false;
    }

    if ("ne" in condObj && contextValue === condObj.ne) {
      return false;
    }

    if ("gt" in condObj) {
      if (typeof contextValue !== "number" || typeof condObj.gt !== "number") {
        return false;
      }
      if (contextValue <= condObj.gt) {
        return false;
      }
    }

    if ("gte" in condObj) {
      if (typeof contextValue !== "number" || typeof condObj.gte !== "number") {
        return false;
      }
      if (contextValue < condObj.gte) {
        return false;
      }
    }

    if ("lt" in condObj) {
      if (typeof contextValue !== "number" || typeof condObj.lt !== "number") {
        return false;
      }
      if (contextValue >= condObj.lt) {
        return false;
      }
    }

    if ("lte" in condObj) {
      if (typeof contextValue !== "number" || typeof condObj.lte !== "number") {
        return false;
      }
      if (contextValue > condObj.lte) {
        return false;
      }
    }

    if ("contains" in condObj) {
      if (typeof contextValue !== "string" || typeof condObj.contains !== "string") {
        return false;
      }
      if (!contextValue.includes(condObj.contains)) {
        return false;
      }
    }

    if ("in" in condObj) {
      if (!Array.isArray(condObj.in) || !condObj.in.includes(contextValue)) {
        return false;
      }
    }
  }

  return true;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check if a rule can be executed based on rate limits
 */
async function checkRateLimits(
  env: Env,
  rule: ParsedAutomationRule
): Promise<boolean> {
  // Check cooldown
  if (rule.cooldown_seconds && rule.cooldown_seconds > 0 && rule.last_triggered_at) {
    const lastTriggered = new Date(rule.last_triggered_at).getTime();
    const cooldownMs = rule.cooldown_seconds * 1000;
    const nowMs = Date.now();

    if (nowMs - lastTriggered < cooldownMs) {
      return false;
    }
  }

  // Check max triggers per hour
  if (rule.max_triggers_per_hour && rule.max_triggers_per_hour > 0) {
    // Count recent triggers (we'd need a trigger log table for accurate counting)
    // For now, we'll use a simpler approach based on trigger_count reset
    // This is a simplified implementation - a production system might want
    // a separate trigger_log table

    // If trigger_count is high, check last_triggered_at
    if (rule.trigger_count >= rule.max_triggers_per_hour) {
      // Reset count if it's been more than an hour
      if (rule.last_triggered_at) {
        const lastTriggered = new Date(rule.last_triggered_at).getTime();
        const oneHourMs = 60 * 60 * 1000;

        if (Date.now() - lastTriggered > oneHourMs) {
          // Reset the counter
          await env.DB.prepare(
            "UPDATE automation_rules SET trigger_count = 0 WHERE id = ?"
          )
            .bind(rule.id)
            .run();
        } else {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Update rule trigger statistics
 */
async function updateRuleTriggerStats(env: Env, ruleId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE automation_rules
     SET trigger_count = trigger_count + 1,
         last_triggered_at = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(now(), now(), ruleId)
    .run();
}

// =============================================================================
// ACTION EXECUTION
// =============================================================================

/**
 * Execute an automation action
 */
async function executeAction(
  env: Env,
  rule: ParsedAutomationRule,
  context: AutomationContext
): Promise<void> {
  const config = rule.action_config || {};

  switch (rule.action_type) {
    case "send_notification":
      await executeSendNotification(env, rule.tenant_id, config, context);
      break;

    case "send_email":
      await executeSendEmail(env, rule.tenant_id, config, context);
      break;

    case "send_webhook":
      await executeSendWebhook(env, rule.tenant_id, config, context);
      break;

    case "create_task":
      await executeCreateTask(env, rule.tenant_id, config, context);
      break;

    case "start_next_job":
      await executeStartNextJob(env, rule.tenant_id, config, context);
      break;

    // Stub implementations for other action types
    case "update_status":
    case "assign_printer":
    case "pause_queue":
    case "resume_queue":
    case "update_inventory":
    case "create_order_item":
    case "run_script":
      console.log(`Action type ${rule.action_type} is not yet implemented`);
      break;

    default:
      console.warn(`Unknown action type: ${rule.action_type}`);
  }
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

/**
 * Send a push notification (queued)
 */
async function executeSendNotification(
  env: Env,
  tenantId: string,
  config: Record<string, unknown>,
  context: AutomationContext
): Promise<void> {
  const message: NotificationMessage = {
    type: "push",
    tenantId,
    payload: {
      title: interpolateTemplate(config.title as string || "Automation Alert", context),
      body: interpolateTemplate(config.body as string || "", context),
      data: context,
    },
    timestamp: Date.now(),
  };

  await env.NOTIFICATIONS.send(message);
}

/**
 * Send an email notification (queued)
 */
async function executeSendEmail(
  env: Env,
  tenantId: string,
  config: Record<string, unknown>,
  context: AutomationContext
): Promise<void> {
  const message: NotificationMessage = {
    type: "email",
    tenantId,
    payload: {
      to: config.to as string | string[],
      subject: interpolateTemplate(config.subject as string || "Automation Alert", context),
      body: interpolateTemplate(config.body as string || "", context),
      html: config.html ? interpolateTemplate(config.html as string, context) : undefined,
    },
    timestamp: Date.now(),
  };

  await env.NOTIFICATIONS.send(message);
}

/**
 * Send a webhook notification (queued)
 */
async function executeSendWebhook(
  env: Env,
  tenantId: string,
  config: Record<string, unknown>,
  context: AutomationContext
): Promise<void> {
  const message: NotificationMessage = {
    type: "webhook",
    tenantId,
    payload: {
      url: config.url as string,
      method: (config.method as string) || "POST",
      headers: config.headers as Record<string, string> | undefined,
      body: {
        event: context,
        timestamp: new Date().toISOString(),
        ...(config.additionalData as Record<string, unknown> || {}),
      },
      secret: config.secret as string | undefined, // For HMAC signing
    },
    timestamp: Date.now(),
  };

  await env.NOTIFICATIONS.send(message);
}

/**
 * Create a worklist task
 */
async function executeCreateTask(
  env: Env,
  tenantId: string,
  config: Record<string, unknown>,
  context: AutomationContext
): Promise<void> {
  const taskId = generateId();
  const timestamp = now();

  await env.DB.prepare(
    `INSERT INTO worklist_tasks (
      id, tenant_id, printer_id,
      title, subtitle, description,
      task_type, priority, status,
      metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  )
    .bind(
      taskId,
      tenantId,
      context.printerId || null,
      interpolateTemplate(config.title as string || "Automated Task", context),
      config.subtitle ? interpolateTemplate(config.subtitle as string, context) : null,
      config.description ? interpolateTemplate(config.description as string, context) : null,
      config.task_type as string || "other",
      config.priority as string || "medium",
      JSON.stringify({ automationContext: context }),
      timestamp,
      timestamp
    )
    .run();

  console.log(`Created automated task: ${taskId}`);
}

/**
 * Start the next queued job for a printer
 */
async function executeStartNextJob(
  env: Env,
  tenantId: string,
  _config: Record<string, unknown>,
  context: AutomationContext
): Promise<void> {
  if (!context.printerId) {
    console.log("start_next_job: No printer ID in context");
    return;
  }

  // Find the next queued job for this printer
  const nextJob = await env.DB.prepare(
    `SELECT id FROM print_jobs
     WHERE tenant_id = ? AND printer_id = ? AND status = 'queued'
     ORDER BY priority DESC, time_submitted ASC
     LIMIT 1`
  )
    .bind(tenantId, context.printerId)
    .first<{ id: string }>();

  if (!nextJob) {
    console.log(`start_next_job: No queued jobs for printer ${context.printerId}`);
    return;
  }

  // Update job status to indicate it should be started
  // The actual start would be triggered by the hub or another process
  await env.DB.prepare(
    `UPDATE print_jobs
     SET status = 'processing', updated_at = ?
     WHERE id = ?`
  )
    .bind(now(), nextJob.id)
    .run();

  console.log(`start_next_job: Queued job ${nextJob.id} for processing`);
}

// =============================================================================
// TEMPLATE HELPERS
// =============================================================================

/**
 * Interpolate template strings with context values
 * Supports {{variable}} syntax
 */
function interpolateTemplate(template: string, context: AutomationContext): string {
  if (!template) return "";

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = context[key];
    if (value === undefined || value === null) {
      return match; // Keep original if no value
    }
    return String(value);
  });
}
