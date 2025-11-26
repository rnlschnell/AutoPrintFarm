/**
 * Cloudflare Workers Environment Bindings
 *
 * This interface defines all bindings available in the Workers environment.
 * These are configured in wrangler.toml and injected at runtime.
 */

import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/**
 * Queue message types for type-safe queue operations
 */

// Base interface for all print events
interface BasePrintEvent {
  type: PrintEventType;
  jobId: string;
  tenantId: string;
  printerId: string | null;
  timestamp: number;
}

export type PrintEventType =
  | "job_started"
  | "job_progress"
  | "job_completed"
  | "job_failed"
  | "job_cancelled"
  | "job_paused"
  | "job_resumed";

interface JobStartedEvent extends BasePrintEvent {
  type: "job_started";
  hubId: string | null;
  commandId: string;
}

interface JobProgressEvent extends BasePrintEvent {
  type: "job_progress";
  progressPercentage: number;
  remainingTimeSeconds?: number;
}

interface JobCompletedEvent extends BasePrintEvent {
  type: "job_completed";
  productSkuId: string | null;
  quantity: number;
  requiresAssembly: boolean;
}

interface JobFailedEvent extends BasePrintEvent {
  type: "job_failed";
  failureReason?: string;
  progressAtFailure?: number;
}

interface JobCancelledEvent extends BasePrintEvent {
  type: "job_cancelled";
  commandId: string;
}

interface JobPausedEvent extends BasePrintEvent {
  type: "job_paused";
  commandId: string;
}

interface JobResumedEvent extends BasePrintEvent {
  type: "job_resumed";
  commandId: string;
}

export type PrintEventMessage =
  | JobStartedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobCancelledEvent
  | JobPausedEvent
  | JobResumedEvent;

export interface FileProcessingMessage {
  type: "extract_metadata" | "generate_thumbnail" | "validate_file";
  fileId: string;
  tenantId: string;
  timestamp: number;
}

export interface NotificationMessage {
  type: "email" | "webhook" | "push";
  tenantId: string;
  userId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface ShopifySyncMessage {
  type: "order_created" | "order_updated" | "inventory_sync";
  tenantId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface DeadLetterMessage {
  originalQueue: string;
  originalMessage: unknown;
  error: string;
  stackTrace?: string;
  attempts: number;
  failedAt: string;
  tenantId?: string;
}

/**
 * Environment bindings available to the Worker
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Object Storage
  R2: R2Bucket;

  // KV Namespace (for caching, sessions, etc.)
  KV: KVNamespace;

  // Queue Producers
  PRINT_EVENTS: Queue<PrintEventMessage>;
  FILE_PROCESSING: Queue<FileProcessingMessage>;
  NOTIFICATIONS: Queue<NotificationMessage>;
  SHOPIFY_SYNC: Queue<ShopifySyncMessage>;
  DEAD_LETTER: Queue<DeadLetterMessage>;

  // Durable Objects
  HUB_CONNECTIONS: DurableObjectNamespace;
  DASHBOARD_BROADCASTS: DurableObjectNamespace;

  // Environment Variables (from wrangler.toml [vars])
  ENVIRONMENT: "development" | "production";
  API_VERSION: string;

  // Secrets (set via `wrangler secret put`)
  JWT_SECRET?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;

  // Better Auth Configuration
  BETTER_AUTH_SECRET: string; // Required: `wrangler secret put BETTER_AUTH_SECRET`
  BETTER_AUTH_URL?: string; // Base URL for auth (defaults to request origin)
  TRUSTED_ORIGINS?: string; // Comma-separated list of trusted origins for CORS

  // Encryption Key (for printer access codes, etc.)
  ENCRYPTION_KEY: string; // Required: `wrangler secret put ENCRYPTION_KEY`
}

/**
 * Request-scoped variables attached during middleware processing
 */
export interface RequestVariables {
  /** Current authenticated user ID */
  userId?: string;

  /** Current authenticated user object */
  user?: {
    id: string;
    email: string;
    full_name: string;
  };

  /** Current tenant ID (from auth or header) */
  tenantId?: string;

  /** Current tenant object */
  tenant?: {
    id: string;
    subdomain: string;
    company_name: string;
  };

  /** Current user's role in the tenant */
  userRole?: "owner" | "admin" | "operator" | "viewer";

  /** Request ID for tracing */
  requestId?: string;

  /** Request start time for logging */
  requestStartTime?: number;
}

/**
 * Extended Hono context with typed environment
 */
export type HonoEnv = {
  Bindings: Env;
  Variables: RequestVariables;
};
