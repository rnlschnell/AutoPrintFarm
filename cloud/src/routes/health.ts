/**
 * PrintFarm Cloud - Health Check Routes
 *
 * Endpoints for monitoring service health and connectivity.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";

const health = new Hono<HonoEnv>();

/**
 * Basic health check
 * Returns 200 OK if the service is running
 */
health.get("/", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Detailed health check with dependency status
 * Checks D1 database connectivity
 */
health.get("/detailed", async (c) => {
  const checks: Record<string, { status: "ok" | "error"; latency?: number; error?: string }> = {};

  // Check D1 Database
  const dbStart = Date.now();
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.database = {
      status: "ok",
      latency: Date.now() - dbStart,
    };
  } catch (error) {
    checks.database = {
      status: "error",
      latency: Date.now() - dbStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Check R2 Bucket (just verify binding exists)
  try {
    // R2 doesn't have a simple ping, so we just check the binding
    if (c.env.R2) {
      checks.storage = { status: "ok" };
    } else {
      checks.storage = { status: "error", error: "R2 binding not available" };
    }
  } catch (error) {
    checks.storage = {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Check KV (just verify binding exists)
  try {
    if (c.env.KV) {
      checks.cache = { status: "ok" };
    } else {
      checks.cache = { status: "error", error: "KV binding not available" };
    }
  } catch (error) {
    checks.cache = {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Determine overall status
  const allHealthy = Object.values(checks).every((check) => check.status === "ok");
  const status = allHealthy ? "healthy" : "degraded";
  const statusCode = allHealthy ? 200 : 503;

  return c.json(
    {
      status,
      version: c.env.API_VERSION,
      environment: c.env.ENVIRONMENT,
      checks,
      timestamp: new Date().toISOString(),
    },
    statusCode
  );
});

/**
 * Readiness check
 * Returns 200 if the service is ready to accept requests
 */
health.get("/ready", async (c) => {
  try {
    // Quick DB check to verify we can process requests
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ready: true }, 200);
  } catch {
    return c.json({ ready: false }, 503);
  }
});

/**
 * Liveness check
 * Returns 200 if the service is alive (minimal check)
 */
health.get("/live", (c) => {
  return c.json({ alive: true }, 200);
});

export { health };
