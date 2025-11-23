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
import { health, auth, tenants, printers, hubs, files } from "./routes";

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
    message: "PrintFarm Cloud API v1 - Phase 6 Print Files & R2 Storage",
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

// Future route mounts (will be added in subsequent phases):
// apiV1.route('/jobs', jobs);           // Phase 7
// apiV1.route('/products', products);   // Phase 8
// apiV1.route('/skus', skus);           // Phase 8
// apiV1.route('/colors', colors);       // Phase 8
// apiV1.route('/plates', plates);       // Phase 8
// apiV1.route('/inventory', inventory); // Phase 9
// apiV1.route('/orders', orders);       // Phase 10
// apiV1.route('/worklist', worklist);   // Phase 11
// apiV1.route('/assembly', assembly);   // Phase 11
// apiV1.route('/wiki', wiki);           // Phase 12
// apiV1.route('/cameras', cameras);     // Phase 12
// apiV1.route('/automation', automation); // Phase 12
// apiV1.route('/analytics', analytics); // Phase 12

// Mount API v1 at /api/v1
app.route("/api/v1", apiV1);

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
import type { Env, FileProcessingMessage } from "./types/env";

// =============================================================================
// EXPORT
// =============================================================================

// Export the Worker with fetch handler (Hono app) and queue handlers
export default {
  // HTTP request handler
  fetch: app.fetch,

  // Queue message handler (Phase 6)
  async queue(batch: MessageBatch<FileProcessingMessage>, env: Env): Promise<void> {
    await handleFileProcessingQueue(batch, env);
  },
};
