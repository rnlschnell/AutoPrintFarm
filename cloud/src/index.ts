/**
 * PrintFarm Cloud API - Cloudflare Workers Entry Point
 *
 * This is the main entry point for the PrintFarm cloud backend.
 * It uses Hono as the web framework for handling HTTP requests.
 *
 * Phase 1: Basic setup with health check endpoint
 * Future phases will add authentication, API routes, WebSocket handlers, etc.
 */

import { Hono } from "hono";
import type { HonoEnv } from "./types/env";

// Re-export Durable Object classes (required by Cloudflare Workers)
export { HubConnection } from "./durable-objects/hub-connection";
export { DashboardBroadcast } from "./durable-objects/dashboard-broadcast";

// Create Hono app with typed environment
const app = new Hono<HonoEnv>();

/**
 * Health check endpoint
 * Returns 200 OK with basic status information
 */
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "printfarm-api",
    version: c.env.API_VERSION,
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Health check endpoint (alternative path)
 */
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * API version info
 */
app.get("/api/v1", (c) => {
  return c.json({
    version: "v1",
    status: "ok",
    message: "PrintFarm Cloud API v1 - Phase 1 infrastructure ready",
  });
});

// Export the Hono app as the default export (Cloudflare Workers format)
export default app;
