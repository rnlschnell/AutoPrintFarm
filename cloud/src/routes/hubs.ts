/**
 * Hub Routes - ESP32 Hub Management
 *
 * CRUD operations for ESP32 hubs that bridge local printers to the cloud.
 * Includes hub claiming workflow for tenant onboarding.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { sha256, generateHex } from "../lib/crypto";
import { discoverPrinters, getHubStatus, isHubOnline, disconnectHub, setHubGpio, updateHubConfig } from "../lib/hub-commands";
import type { Hub } from "../types";

export const hubs = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const claimHubSchema = z.object({
  hub_id: z.string().min(1),
  claim_code: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
});

const registerHubSchema = z.object({
  hub_id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
});

const updateHubSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

// =============================================================================
// LIST HUBS
// =============================================================================

/**
 * GET /api/v1/hubs
 * List all hubs for the current tenant
 */
hubs.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT h.*,
      (SELECT COUNT(*) FROM printers WHERE hub_id = h.id) as printer_count
    FROM hubs h
    WHERE h.tenant_id = ?
    ORDER BY h.name ASC, h.created_at DESC`
  )
    .bind(tenantId)
    .all<Hub & { printer_count: number }>();

  // Sanitize: don't return secret_hash
  const sanitizedHubs = (result.results || []).map((hub) => ({
    ...hub,
    secret_hash: undefined,
  }));

  return c.json({
    success: true,
    data: sanitizedHubs,
    meta: {
      total: sanitizedHubs.length,
    },
  });
});

// =============================================================================
// REGISTER HUB (Simple BLE Flow)
// =============================================================================

/**
 * POST /api/v1/hubs/register
 * Register a new hub directly for the current tenant (no claim code needed)
 *
 * This endpoint is called by the frontend after BLE provisioning succeeds.
 * It creates the hub record and immediately assigns it to the current tenant.
 *
 * This is idempotent - if the hub is already registered to this tenant, it
 * returns success with the existing hub data.
 */
hubs.post(
  "/register",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof registerHubSchema>;
    try {
      const rawBody = await c.req.json();
      body = registerHubSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check if hub already exists
    const existing = await c.env.DB.prepare(
      "SELECT id, tenant_id FROM hubs WHERE id = ?"
    )
      .bind(body.hub_id)
      .first<{ id: string; tenant_id: string | null }>();

    if (existing) {
      if (existing.tenant_id === tenantId) {
        // Already registered to this tenant - return success (idempotent)
        const hub = await c.env.DB.prepare("SELECT * FROM hubs WHERE id = ?")
          .bind(body.hub_id)
          .first<Hub>();
        return c.json({
          success: true,
          message: "Hub already registered to your organization",
          data: { ...hub, secret_hash: undefined },
        });
      }
      if (existing.tenant_id === null) {
        // Hub was previously released/unclaimed - allow re-registration
        const now = new Date().toISOString();
        const hubName = body.name || `Hub ${body.hub_id.slice(-6)}`;

        await c.env.DB.prepare(
          `UPDATE hubs SET tenant_id = ?, name = ?, claimed_at = ?, updated_at = ? WHERE id = ?`
        )
          .bind(tenantId, hubName, now, now, body.hub_id)
          .run();

        const hub = await c.env.DB.prepare("SELECT * FROM hubs WHERE id = ?")
          .bind(body.hub_id)
          .first<Hub>();

        return c.json({
          success: true,
          message: "Hub re-registered successfully",
          data: { ...hub, secret_hash: undefined },
        });
      }
      // Registered to a different tenant
      throw new ApiError(
        "This hub is already registered to another organization",
        409,
        "ALREADY_REGISTERED"
      );
    }

    // Generate a secret for hub authentication (used for WebSocket auth later)
    const secret = generateHex(32);
    const secretHash = await sha256(secret);

    const now = new Date().toISOString();
    const hubName = body.name || `Hub ${body.hub_id.slice(-6)}`;

    // Create the hub record
    await c.env.DB.prepare(
      `INSERT INTO hubs (id, tenant_id, name, secret_hash, is_online, claimed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    )
      .bind(body.hub_id, tenantId, hubName, secretHash, now, now, now)
      .run();

    // Fetch the created hub
    const hub = await c.env.DB.prepare("SELECT * FROM hubs WHERE id = ?")
      .bind(body.hub_id)
      .first<Hub>();

    return c.json(
      {
        success: true,
        message: "Hub registered successfully",
        data: {
          ...hub,
          secret_hash: undefined,
        },
      },
      201
    );
  }
);

// =============================================================================
// GET SINGLE HUB
// =============================================================================

/**
 * GET /api/v1/hubs/:id
 * Get a single hub by ID with connected printers
 */
hubs.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const hubId = c.req.param("id");

  const hub = await c.env.DB.prepare(
    `SELECT h.*,
      (SELECT COUNT(*) FROM printers WHERE hub_id = h.id) as printer_count
    FROM hubs h
    WHERE h.id = ? AND h.tenant_id = ?`
  )
    .bind(hubId, tenantId)
    .first<Hub & { printer_count: number }>();

  if (!hub) {
    throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
  }

  // Get connected printers
  const printersResult = await c.env.DB.prepare(
    `SELECT id, name, model, status, is_connected
    FROM printers
    WHERE hub_id = ? AND tenant_id = ?
    ORDER BY name`
  )
    .bind(hubId, tenantId)
    .all<{
      id: string;
      name: string;
      model: string;
      status: string;
      is_connected: number;
    }>();

  return c.json({
    success: true,
    data: {
      ...hub,
      secret_hash: undefined, // Don't expose secret
      printers: printersResult.results || [],
    },
  });
});

// =============================================================================
// CLAIM HUB
// =============================================================================

/**
 * POST /api/v1/hubs/claim
 * Claim an unclaimed hub for the current tenant
 *
 * The claim code is a one-time code generated by the hub during initial setup.
 * It's displayed on the hub's screen or serial output.
 */
hubs.post(
  "/claim",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof claimHubSchema>;
    try {
      const rawBody = await c.req.json();
      body = claimHubSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Find the hub
    const hub = await c.env.DB.prepare(
      "SELECT id, tenant_id, secret_hash FROM hubs WHERE id = ?"
    )
      .bind(body.hub_id)
      .first<{ id: string; tenant_id: string | null; secret_hash: string }>();

    if (!hub) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    if (hub.tenant_id) {
      if (hub.tenant_id === tenantId) {
        throw new ApiError(
          "This hub is already claimed by your organization",
          409,
          "ALREADY_CLAIMED_BY_YOU"
        );
      }
      throw new ApiError(
        "This hub is already claimed by another organization",
        409,
        "ALREADY_CLAIMED"
      );
    }

    // Verify the claim code
    // The claim code is verified by hashing it and comparing to secret_hash
    // This allows the hub to generate a random secret and display a claim code
    const claimCodeHash = await sha256(body.claim_code);

    // For security, the claim code verification uses the stored secret_hash
    // The hub generates: secret_hash = sha256(claim_code)
    // Note: In production, you might want a more sophisticated verification
    const isValid = claimCodeHash === hub.secret_hash;

    if (!isValid) {
      throw new ApiError("Invalid claim code", 401, "INVALID_CLAIM_CODE");
    }

    const now = new Date().toISOString();

    // Claim the hub
    await c.env.DB.prepare(
      `UPDATE hubs SET
        tenant_id = ?,
        name = ?,
        claimed_at = ?,
        updated_at = ?
      WHERE id = ?`
    )
      .bind(tenantId, body.name || `Hub ${body.hub_id.slice(-6)}`, now, now, body.hub_id)
      .run();

    // Fetch the updated hub
    const claimedHub = await c.env.DB.prepare(
      "SELECT * FROM hubs WHERE id = ?"
    )
      .bind(body.hub_id)
      .first<Hub>();

    return c.json(
      {
        success: true,
        message: "Hub claimed successfully",
        data: {
          ...claimedHub,
          secret_hash: undefined,
        },
      },
      201
    );
  }
);

// =============================================================================
// UPDATE HUB
// =============================================================================

/**
 * PUT /api/v1/hubs/:id
 * Update hub settings (name)
 */
hubs.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Check hub exists and belongs to tenant
    const existing = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateHubSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateHubSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    if (!body.name) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE hubs SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(body.name, now, hubId, tenantId)
      .run();

    // Send config update to hub if it's online
    const hubOnline = await isHubOnline(c.env, hubId);
    if (hubOnline) {
      // Best-effort: don't fail the request if hub update fails
      try {
        await updateHubConfig(c.env, hubId, { hub_name: body.name });
      } catch (error) {
        console.warn(`[hubs] Failed to send config update to hub ${hubId}:`, error);
      }
    }

    // Fetch updated hub
    const hub = await c.env.DB.prepare("SELECT * FROM hubs WHERE id = ?")
      .bind(hubId)
      .first<Hub>();

    return c.json({
      success: true,
      data: {
        ...hub,
        secret_hash: undefined,
      },
    });
  }
);

// =============================================================================
// UNCLAIM/RELEASE HUB
// =============================================================================

/**
 * DELETE /api/v1/hubs/:id
 * Unclaim/release a hub from the current tenant
 *
 * This does NOT delete the hub - it just releases it so it can be claimed again.
 * All printers assigned to this hub will have their hub_id set to NULL.
 */
hubs.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Check hub exists and belongs to tenant
    const existing = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    const now = new Date().toISOString();

    // Use a batch to:
    // 1. Unassign all printers from this hub
    // 2. Release the hub (set tenant_id to NULL)
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE printers SET hub_id = NULL, is_connected = 0, updated_at = ? WHERE hub_id = ?`
      ).bind(now, hubId),
      c.env.DB.prepare(
        `UPDATE hubs SET tenant_id = NULL, name = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?`
      ).bind(now, hubId),
    ]);

    return c.json({
      success: true,
      message: "Hub released successfully. All printers have been unassigned.",
    });
  }
);

// =============================================================================
// HUB STATUS (for internal/admin use)
// =============================================================================

/**
 * GET /api/v1/hubs/:id/status
 * Get hub connection status and last seen info
 */
hubs.get("/:id/status", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const hubId = c.req.param("id");

  const hub = await c.env.DB.prepare(
    `SELECT id, name, is_online, last_seen_at, firmware_version, ip_address
    FROM hubs
    WHERE id = ? AND tenant_id = ?`
  )
    .bind(hubId, tenantId)
    .first<{
      id: string;
      name: string;
      is_online: number;
      last_seen_at: string | null;
      firmware_version: string | null;
      ip_address: string | null;
    }>();

  if (!hub) {
    throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
  }

  // Calculate if hub is stale (no heartbeat in 2 minutes)
  let isStale = false;
  if (hub.last_seen_at) {
    const lastSeen = new Date(hub.last_seen_at).getTime();
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    isStale = lastSeen < twoMinutesAgo;
  }

  return c.json({
    success: true,
    data: {
      ...hub,
      is_stale: isStale,
    },
  });
});

// =============================================================================
// HUB DISCOVERY (Phase 13)
// =============================================================================

/**
 * POST /api/v1/hubs/:id/discover
 * Trigger printer discovery on a hub
 *
 * This sends a discover_printers command to the hub, which will
 * scan the local network for compatible printers (Bambu Lab, etc.)
 */
hubs.post(
  "/:id/discover",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Verify hub belongs to tenant
    const hub = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!hub) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, hubId);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Send discover command (doesn't wait for ack - discovery runs async)
    const result = await discoverPrinters(c.env, hubId);

    return c.json({
      success: true,
      message: "Discovery started. Results will be available shortly.",
      data: {
        command_id: result.command_id,
        hub_id: hubId,
      },
    });
  }
);

/**
 * GET /api/v1/hubs/:id/connection
 * Get detailed hub connection status from Durable Object
 */
hubs.get(
  "/:id/connection",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Verify hub belongs to tenant
    const hub = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!hub) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    // Get status from Durable Object
    const status = await getHubStatus(c.env, hubId);

    return c.json({
      success: true,
      data: status.data,
    });
  }
);

// =============================================================================
// HUB DISCONNECT
// =============================================================================

/**
 * POST /api/v1/hubs/:id/disconnect
 * Send disconnect command to hub (hub will need restart to reconnect)
 */
hubs.post(
  "/:id/disconnect",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Verify hub belongs to tenant
    const hub = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!hub) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, hubId);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Send disconnect command
    const result = await disconnectHub(c.env, hubId);

    if (!result.success) {
      return c.json({
        success: false,
        error: {
          code: "COMMAND_FAILED",
          message: result.error || "Failed to send disconnect command",
        },
      }, 500);
    }

    return c.json({
      success: true,
      message: "Hub disconnect command sent. Hub will need to be restarted to reconnect.",
      data: {
        command_id: result.command_id,
        hub_id: hubId,
      },
    });
  }
);

// =============================================================================
// HUB GPIO CONTROL
// =============================================================================

const gpioSetSchema = z.object({
  pin: z.number().int().min(0).max(48),
  state: z.boolean(),
});

/**
 * POST /api/v1/hubs/:id/gpio
 * Set GPIO pin state on hub
 */
hubs.post(
  "/:id/gpio",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const hubId = c.req.param("id");

    // Parse and validate request body
    let body: z.infer<typeof gpioSetSchema>;
    try {
      const rawBody = await c.req.json();
      body = gpioSetSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Verify hub belongs to tenant
    const hub = await c.env.DB.prepare(
      "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
    )
      .bind(hubId, tenantId)
      .first();

    if (!hub) {
      throw new ApiError("Hub not found", 404, "HUB_NOT_FOUND");
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, hubId);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Send GPIO command
    const result = await setHubGpio(c.env, hubId, body.pin, body.state);

    if (!result.success) {
      return c.json({
        success: false,
        error: {
          code: "COMMAND_FAILED",
          message: result.error || "Failed to set GPIO",
        },
      }, 500);
    }

    return c.json({
      success: true,
      message: `GPIO ${body.pin} set to ${body.state ? "HIGH" : "LOW"}`,
      data: {
        command_id: result.command_id,
        hub_id: hubId,
        pin: body.pin,
        state: body.state,
      },
    });
  }
);
