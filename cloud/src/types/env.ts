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
export interface PrintEventMessage {
  type: "job_started" | "job_completed" | "job_failed" | "printer_status_changed";
  payload: Record<string, unknown>;
  timestamp: number;
}

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
}

/**
 * Extended Hono context with typed environment
 */
export type HonoEnv = {
  Bindings: Env;
  Variables: {
    // Add request-scoped variables here as they're implemented
    // tenantId?: string;
    // userId?: string;
    // userRole?: string;
  };
};
