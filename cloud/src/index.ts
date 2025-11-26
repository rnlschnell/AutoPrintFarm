/**
 * PrintFarm Cloud API - Cloudflare Workers Entry Point
 *
 * This is the main entry point for the PrintFarm cloud backend.
 * It uses Hono as the web framework for handling HTTP requests.
 *
 * Phase 3: Core API Foundation
 * - Hono app with middleware (CORS, logging, error handling)
 * - Health check endpoints with DB connectivity tests
 * - TypeScript types, database helpers, R2 helpers, crypto utilities
 */

import { Hono } from "hono";
import type { HonoEnv } from "./types/env";

// Middleware
import { corsMiddleware } from "./middleware/cors";
import { loggerMiddleware } from "./middleware/logger";
import { errorHandler, notFoundHandler } from "./middleware/errors";

// Routes
import {
  health,
  auth,
  tenants,
  printers,
  hubs,
  files,
  jobs,
  products,
  skus,
  colors,
  plates,
  inventory,
  orders,
  integrations,
  webhooks,
  worklist,
  assembly,
  wiki,
  cameras,
  automation,
  analytics,
  materials,
  admin,
} from "./routes";

// Re-export Durable Object classes (required by Cloudflare Workers)
export { HubConnection } from "./durable-objects/hub-connection";
export { DashboardBroadcast } from "./durable-objects/dashboard-broadcast";

// Create Hono app with typed environment
const app = new Hono<HonoEnv>();

// =============================================================================
// GLOBAL MIDDLEWARE
// =============================================================================

// CORS handling (must be first to handle preflight requests)
app.use("*", corsMiddleware());

// Request logging
app.use("*", loggerMiddleware());

// =============================================================================
// ROOT ENDPOINTS
// =============================================================================

/**
 * Root endpoint - API info
 */
app.get("/", (c) => {
  return c.json({
    name: "PrintFarm Cloud API",
    version: c.env.API_VERSION,
    environment: c.env.ENVIRONMENT,
    status: "operational",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// HEALTH CHECK ROUTES
// =============================================================================

// Mount health routes at /health
app.route("/health", health);

// =============================================================================
// API V1 ROUTES
// =============================================================================

// Create API v1 router
const apiV1 = new Hono<HonoEnv>();

/**
 * API v1 root - version info
 */
apiV1.get("/", (c) => {
  return c.json({
    version: "v1",
    status: "operational",
    message: "PrintFarm Cloud API v1 - Phase 12 Supporting Features",
    endpoints: {
      health: "/health",
      healthDetailed: "/health/detailed",
      healthReady: "/health/ready",
      healthLive: "/health/live",
      // Auth endpoints (Better Auth)
      signUp: "POST /api/v1/auth/sign-up/email",
      signIn: "POST /api/v1/auth/sign-in/email",
      signOut: "POST /api/v1/auth/sign-out",
      session: "GET /api/v1/auth/session",
      // Tenant endpoints
      tenants: "/api/v1/tenants",
      // Printer management (Phase 5)
      printers: "/api/v1/printers",
      hubs: "/api/v1/hubs",
      // Print files (Phase 6)
      files: "/api/v1/files",
      // Print jobs (Phase 7)
      jobs: "/api/v1/jobs",
      // Products & SKUs (Phase 8)
      products: "/api/v1/products",
      skus: "/api/v1/skus",
      colors: "/api/v1/colors",
      plates: "/api/v1/plates",
      // Inventory (Phase 9)
      inventory: "/api/v1/inventory",
      // Orders & Integrations (Phase 10)
      orders: "/api/v1/orders",
      integrations: "/api/v1/integrations",
      webhooks: "/webhooks",
      // Worklist & Assembly (Phase 11)
      worklist: "/api/v1/worklist",
      assembly: "/api/v1/assembly",
      // Supporting features (Phase 12)
      wiki: "/api/v1/wiki",
      cameras: "/api/v1/cameras",
      automation: "/api/v1/automation",
      analytics: "/api/v1/analytics",
      // Admin routes (Phase 15)
      admin: "/api/v1/admin",
    },
  });
});

// Auth routes (Phase 4)
apiV1.route("/auth", auth);
apiV1.route("/tenants", tenants);

// Printer management routes (Phase 5)
apiV1.route("/printers", printers);
apiV1.route("/hubs", hubs);

// Print files routes (Phase 6)
apiV1.route("/files", files);

// Print jobs routes (Phase 7)
apiV1.route("/jobs", jobs);

// Products & SKUs routes (Phase 8)
apiV1.route("/products", products);
apiV1.route("/skus", skus);
apiV1.route("/colors", colors);
apiV1.route("/plates", plates);

// Inventory routes (Phase 9)
apiV1.route("/inventory", inventory);

// Orders & Integrations routes (Phase 10)
apiV1.route("/orders", orders);
apiV1.route("/integrations", integrations);

// Worklist & Assembly routes (Phase 11)
apiV1.route("/worklist", worklist);
apiV1.route("/assembly", assembly);

// Supporting features routes (Phase 12)
apiV1.route("/wiki", wiki);
apiV1.route("/cameras", cameras);
apiV1.route("/automation", automation);
apiV1.route("/analytics", analytics);

// Material inventory routes
apiV1.route("/materials", materials);

// Admin routes (Phase 15)
apiV1.route("/admin", admin);

// Mount API v1 at /api/v1
app.route("/api/v1", apiV1);

// =============================================================================
// WEBHOOK ROUTES (Phase 10)
// =============================================================================

// Webhooks are mounted at root level (not under /api/v1)
// to make them easier to configure in external services
app.route("/webhooks", webhooks);

// =============================================================================
// WEBSOCKET ROUTES (Phase 13 & 14)
// =============================================================================

/**
 * WebSocket upgrade handler for hub connections
 * Route: /ws/hub/:id
 *
 * This route upgrades HTTP connections to WebSocket and routes them
 * to the appropriate HubConnection Durable Object.
 */
app.get("/ws/hub/:id", async (c) => {
  const hubId = c.req.param("id");

  if (!hubId) {
    return c.text("Hub ID required", 400);
  }

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  // Get the HubConnection Durable Object stub
  // Each hub has its own DO instance, identified by the hub ID
  const doId = c.env.HUB_CONNECTIONS.idFromName(hubId);
  const stub = c.env.HUB_CONNECTIONS.get(doId);

  // Forward the WebSocket upgrade request to the Durable Object
  // The DO will handle the upgrade and manage the connection
  return stub.fetch(c.req.raw);
});

/**
 * WebSocket upgrade handler for dashboard connections (Phase 14)
 * Route: /ws/dashboard?tenant=<tenant_id>
 *
 * This route upgrades HTTP connections to WebSocket and routes them
 * to the appropriate DashboardBroadcast Durable Object.
 *
 * Query parameters:
 * - tenant: Required tenant ID for the connection
 *
 * After connection, clients must send an auth message with their session token.
 */
app.get("/ws/dashboard", async (c) => {
  const tenantId = c.req.query("tenant");

  if (!tenantId) {
    return c.text("Tenant ID required (use ?tenant=<id>)", 400);
  }

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  // Get the DashboardBroadcast Durable Object stub
  // Each tenant has its own DO instance, identified by the tenant ID
  const doId = c.env.DASHBOARD_BROADCASTS.idFromName(tenantId);
  const stub = c.env.DASHBOARD_BROADCASTS.get(doId);

  // Forward the WebSocket upgrade request to the Durable Object
  // The DO will handle the upgrade, auth, and subscriptions
  return stub.fetch(c.req.raw);
});

/**
 * Get dashboard WebSocket connection status (Phase 14)
 * Route: GET /ws/dashboard/status?tenant=<tenant_id>
 *
 * Returns connection statistics for a tenant's dashboard broadcast.
 */
app.get("/ws/dashboard/status", async (c) => {
  const tenantId = c.req.query("tenant");

  if (!tenantId) {
    return c.json({ success: false, error: "Tenant ID required" }, 400);
  }

  // Get the DashboardBroadcast Durable Object stub
  const doId = c.env.DASHBOARD_BROADCASTS.idFromName(tenantId);
  const stub = c.env.DASHBOARD_BROADCASTS.get(doId);

  // Forward status request to the Durable Object
  const statusRequest = new Request("http://internal/status", {
    method: "GET",
  });

  return stub.fetch(statusRequest);
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler for unmatched routes
app.notFound(notFoundHandler);

// Global error handler
app.onError(errorHandler);

// =============================================================================
// QUEUE HANDLERS
// =============================================================================

// Import queue handlers
import { handleFileProcessingQueue } from "./queues/file-processing";
import { handlePrintEventsQueue, type PrintEventMessage } from "./queues/print-events";
import { handleShopifySyncQueue } from "./queues/shopify-sync";
import { handleNotificationsQueue } from "./queues/notifications";
import { handleDeadLetterQueue } from "./queues/dead-letter";
import type { Env, FileProcessingMessage, ShopifySyncMessage, NotificationMessage, DeadLetterMessage } from "./types/env";

// Union type for all queue message types
type QueueMessage = FileProcessingMessage | PrintEventMessage | ShopifySyncMessage | NotificationMessage | DeadLetterMessage;

// =============================================================================
// EXPORT
// =============================================================================

// Export the Worker with fetch handler (Hono app), queue handlers, and scheduled handlers
export default {
  // HTTP request handler
  fetch: app.fetch,

  // Queue message handler (Phases 6, 7, and 10)
  // Cloudflare routes messages based on the queue name configured in wrangler.toml
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    // Check the queue name to determine which handler to use
    // The batch.queue property contains the queue name
    const queueName = (batch as MessageBatch<QueueMessage> & { queue: string }).queue;

    if (queueName === "file-processing") {
      await handleFileProcessingQueue(
        batch as MessageBatch<FileProcessingMessage>,
        env
      );
    } else if (queueName === "print-events") {
      await handlePrintEventsQueue(
        batch as MessageBatch<PrintEventMessage>,
        env
      );
    } else if (queueName === "shopify-sync") {
      await handleShopifySyncQueue(
        batch as MessageBatch<ShopifySyncMessage>,
        env
      );
    } else if (queueName === "notifications") {
      await handleNotificationsQueue(
        batch as MessageBatch<NotificationMessage>,
        env
      );
    } else if (queueName === "dead-letter") {
      await handleDeadLetterQueue(
        batch as MessageBatch<DeadLetterMessage>,
        env
      );
    } else {
      console.warn(`Unknown queue: ${queueName}`);
      // Acknowledge all messages to prevent redelivery
      for (const message of batch.messages) {
        message.ack();
      }
    }
  },

  // Scheduled task handler (Cron Triggers)
  // Runs daily at 3:00 AM UTC to clean up expired sessions
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[Scheduled] Running cron job at ${new Date().toISOString()}`);

    // Clean up expired sessions
    try {
      const result = await env.DB.prepare(
        "DELETE FROM sessions WHERE expires_at < datetime('now')"
      ).run();

      console.log(
        `[Scheduled] Session cleanup complete. Deleted ${result.meta.changes} expired sessions.`
      );
    } catch (error) {
      console.error("[Scheduled] Session cleanup failed:", error);
    }

    // Clean up expired verifications (password reset tokens, etc.)
    try {
      const result = await env.DB.prepare(
        "DELETE FROM verifications WHERE expires_at < datetime('now')"
      ).run();

      console.log(
        `[Scheduled] Verification cleanup complete. Deleted ${result.meta.changes} expired tokens.`
      );
    } catch (error) {
      console.error("[Scheduled] Verification cleanup failed:", error);
    }

    // Clean up old rate limit keys from KV (optional, KV has TTL so this is mainly for hygiene)
    // Note: KV entries with expirationTtl are automatically cleaned up by Cloudflare
    console.log("[Scheduled] Cron job completed successfully.");
  },
};
