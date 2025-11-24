/**
 * Camera Routes - Camera Management & Streaming
 *
 * CRUD operations for cameras with snapshot support.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId, encryptAES256GCM, decryptAES256GCM } from "../lib/crypto";
import { paginate, getCount, now } from "../lib/db";
import type { Camera, CameraType } from "../types";

export const cameras = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const cameraTypes: CameraType[] = ["bambu", "ip", "usb", "rtsp", "mjpeg"];

const createCameraSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  printer_id: z.string().optional(),
  hub_id: z.string().optional(),
  camera_type: z.enum(cameraTypes as [CameraType, ...CameraType[]]),
  stream_url: z.string().max(500).optional(),
  snapshot_url: z.string().max(500).optional(),
  ip_address: z.string().max(45).optional(), // IPv6 max length
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  serial_number: z.string().max(100).optional(),
  is_active: z.boolean().default(true),
  rotation: z.number().int().min(0).max(270).optional(),
  flip_horizontal: z.boolean().default(false),
  flip_vertical: z.boolean().default(false),
});

const updateCameraSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  printer_id: z.string().nullable().optional(),
  hub_id: z.string().nullable().optional(),
  camera_type: z.enum(cameraTypes as [CameraType, ...CameraType[]]).optional(),
  stream_url: z.string().max(500).nullable().optional(),
  snapshot_url: z.string().max(500).nullable().optional(),
  ip_address: z.string().max(45).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  username: z.string().max(100).nullable().optional(),
  password: z.string().max(200).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  rotation: z.number().int().min(0).max(270).nullable().optional(),
  flip_horizontal: z.boolean().optional(),
  flip_vertical: z.boolean().optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Encrypt camera password for storage
 */
async function encryptPassword(password: string, env: { ENCRYPTION_KEY: string }): Promise<string> {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY not configured");
  }
  return encryptAES256GCM(password, env.ENCRYPTION_KEY);
}

/**
 * Decrypt camera password
 */
async function decryptPassword(encrypted: string, env: { ENCRYPTION_KEY: string }): Promise<string> {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY not configured");
  }
  return decryptAES256GCM(encrypted, env.ENCRYPTION_KEY);
}

/**
 * Sanitize camera response (remove password)
 */
function sanitizeCamera(camera: Camera): Omit<Camera, "password"> & { password?: undefined } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = camera;
  return rest;
}

// =============================================================================
// LIST CAMERAS
// =============================================================================

/**
 * GET /api/v1/cameras
 * List all cameras for the current tenant
 * Supports filtering by printer_id, is_active, camera_type
 * Supports pagination
 */
cameras.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const printerId = c.req.query("printer_id");
  const hubId = c.req.query("hub_id");
  const isActive = c.req.query("is_active");
  const cameraType = c.req.query("camera_type");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (printerId) {
    whereClause += " AND printer_id = ?";
    params.push(printerId);
  }

  if (hubId) {
    whereClause += " AND hub_id = ?";
    params.push(hubId);
  }

  if (isActive !== undefined) {
    whereClause += " AND is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  if (cameraType) {
    whereClause += " AND camera_type = ?";
    params.push(cameraType);
  }

  // Get total count
  const total = await getCount(c.env.DB, "cameras", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query cameras
  const query = `
    SELECT * FROM cameras
    WHERE ${whereClause}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<Camera>();

  // Sanitize cameras (remove passwords)
  const sanitizedCameras = (result.results || []).map(sanitizeCamera);

  return c.json({
    success: true,
    data: sanitizedCameras,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: offset + (result.results?.length || 0) < total,
    },
  });
});

// =============================================================================
// GET SINGLE CAMERA
// =============================================================================

/**
 * GET /api/v1/cameras/:id
 * Get a single camera by ID
 */
cameras.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const cameraId = c.req.param("id");

  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND tenant_id = ?"
  )
    .bind(cameraId, tenantId)
    .first<Camera>();

  if (!camera) {
    throw new ApiError("Camera not found", 404, "CAMERA_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: sanitizeCamera(camera),
  });
});

// =============================================================================
// CREATE CAMERA
// =============================================================================

/**
 * POST /api/v1/cameras
 * Create a new camera
 */
cameras.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createCameraSchema>;
    try {
      const rawBody = await c.req.json();
      body = createCameraSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate printer_id if provided
    if (body.printer_id) {
      const printer = await c.env.DB.prepare(
        "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.printer_id, tenantId)
        .first();

      if (!printer) {
        throw new ApiError(
          "Printer not found or does not belong to this tenant",
          404,
          "PRINTER_NOT_FOUND"
        );
      }
    }

    // Validate hub_id if provided
    if (body.hub_id) {
      const hub = await c.env.DB.prepare(
        "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.hub_id, tenantId)
        .first();

      if (!hub) {
        throw new ApiError(
          "Hub not found or does not belong to this tenant",
          404,
          "HUB_NOT_FOUND"
        );
      }
    }

    const cameraId = generateId();
    const timestamp = now();

    // Encrypt password if provided
    let encryptedPassword: string | null = null;
    if (body.password) {
      encryptedPassword = await encryptPassword(body.password, c.env);
    }

    await c.env.DB.prepare(
      `INSERT INTO cameras (
        id, tenant_id, name, description, printer_id, hub_id,
        camera_type, stream_url, snapshot_url, ip_address, port,
        username, password, serial_number, is_active, is_online,
        rotation, flip_horizontal, flip_vertical,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
      .bind(
        cameraId,
        tenantId,
        body.name,
        body.description || null,
        body.printer_id || null,
        body.hub_id || null,
        body.camera_type,
        body.stream_url || null,
        body.snapshot_url || null,
        body.ip_address || null,
        body.port || null,
        body.username || null,
        encryptedPassword,
        body.serial_number || null,
        body.is_active ? 1 : 0,
        body.rotation || 0,
        body.flip_horizontal ? 1 : 0,
        body.flip_vertical ? 1 : 0,
        timestamp,
        timestamp
      )
      .run();

    // Fetch the created camera
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ?"
    )
      .bind(cameraId)
      .first<Camera>();

    return c.json(
      {
        success: true,
        data: sanitizeCamera(camera!),
      },
      201
    );
  }
);

// =============================================================================
// UPDATE CAMERA
// =============================================================================

/**
 * PUT /api/v1/cameras/:id
 * Update a camera
 */
cameras.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const cameraId = c.req.param("id");

    // Check camera exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM cameras WHERE id = ? AND tenant_id = ?"
    )
      .bind(cameraId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Camera not found", 404, "CAMERA_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateCameraSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateCameraSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Validate printer_id if provided
    if (body.printer_id) {
      const printer = await c.env.DB.prepare(
        "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.printer_id, tenantId)
        .first();

      if (!printer) {
        throw new ApiError(
          "Printer not found or does not belong to this tenant",
          404,
          "PRINTER_NOT_FOUND"
        );
      }
    }

    // Validate hub_id if provided
    if (body.hub_id) {
      const hub = await c.env.DB.prepare(
        "SELECT id FROM hubs WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.hub_id, tenantId)
        .first();

      if (!hub) {
        throw new ApiError(
          "Hub not found or does not belong to this tenant",
          404,
          "HUB_NOT_FOUND"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const fields: Array<{
      key: keyof typeof body;
      column: string;
      transform?: (v: unknown) => unknown;
    }> = [
      { key: "name", column: "name" },
      { key: "description", column: "description" },
      { key: "printer_id", column: "printer_id" },
      { key: "hub_id", column: "hub_id" },
      { key: "camera_type", column: "camera_type" },
      { key: "stream_url", column: "stream_url" },
      { key: "snapshot_url", column: "snapshot_url" },
      { key: "ip_address", column: "ip_address" },
      { key: "port", column: "port" },
      { key: "username", column: "username" },
      { key: "serial_number", column: "serial_number" },
      { key: "is_active", column: "is_active", transform: (v) => (v ? 1 : 0) },
      { key: "rotation", column: "rotation" },
      { key: "flip_horizontal", column: "flip_horizontal", transform: (v) => (v ? 1 : 0) },
      { key: "flip_vertical", column: "flip_vertical", transform: (v) => (v ? 1 : 0) },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        const value = body[field.key];
        values.push(
          field.transform
            ? (field.transform(value) as string | number | null)
            : (value as string | number | null)
        );
      }
    }

    // Handle password separately (needs encryption)
    if (body.password !== undefined) {
      updates.push("password = ?");
      if (body.password === null) {
        values.push(null);
      } else {
        const encryptedPassword = await encryptPassword(body.password, c.env);
        values.push(encryptedPassword);
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(now());

    values.push(cameraId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE cameras SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated camera
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ?"
    )
      .bind(cameraId)
      .first<Camera>();

    return c.json({
      success: true,
      data: sanitizeCamera(camera!),
    });
  }
);

// =============================================================================
// UPDATE CAMERA STATUS
// =============================================================================

/**
 * PUT /api/v1/cameras/:id/status
 * Update camera online status
 */
cameras.put(
  "/:id/status",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const cameraId = c.req.param("id");

    const body = await c.req.json<{
      is_online?: boolean;
      last_error?: string | null;
    }>();

    // Check camera exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM cameras WHERE id = ? AND tenant_id = ?"
    )
      .bind(cameraId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Camera not found", 404, "CAMERA_NOT_FOUND");
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.is_online !== undefined) {
      updates.push("is_online = ?");
      values.push(body.is_online ? 1 : 0);
    }

    if (body.last_error !== undefined) {
      updates.push("last_error = ?");
      values.push(body.last_error);
    }

    if (updates.length === 0) {
      throw new ApiError("No status updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(now());

    values.push(cameraId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE cameras SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ?"
    )
      .bind(cameraId)
      .first<Camera>();

    return c.json({
      success: true,
      data: sanitizeCamera(camera!),
    });
  }
);

// =============================================================================
// GET CAMERA SNAPSHOT
// =============================================================================

/**
 * GET /api/v1/cameras/:id/snapshot
 * Fetch and return a snapshot from the camera
 */
cameras.get(
  "/:id/snapshot",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const cameraId = c.req.param("id");

    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND tenant_id = ?"
    )
      .bind(cameraId, tenantId)
      .first<Camera>();

    if (!camera) {
      throw new ApiError("Camera not found", 404, "CAMERA_NOT_FOUND");
    }

    if (!camera.is_active) {
      throw new ApiError("Camera is not active", 400, "CAMERA_INACTIVE");
    }

    if (!camera.snapshot_url) {
      throw new ApiError("Camera has no snapshot URL configured", 400, "NO_SNAPSHOT_URL");
    }

    try {
      // Build request options with auth if needed
      const fetchOptions: RequestInit = {
        method: "GET",
        headers: {},
      };

      // Add basic auth if credentials provided
      if (camera.username && camera.password) {
        const decryptedPassword = await decryptPassword(camera.password, c.env);
        const auth = btoa(`${camera.username}:${decryptedPassword}`);
        (fetchOptions.headers as Record<string, string>)["Authorization"] = `Basic ${auth}`;
      }

      // Fetch snapshot with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(camera.snapshot_url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Update camera status
        await c.env.DB.prepare(
          "UPDATE cameras SET is_online = 0, last_error = ?, updated_at = ? WHERE id = ?"
        )
          .bind(`HTTP ${response.status}: ${response.statusText}`, now(), cameraId)
          .run();

        throw new ApiError(
          `Failed to fetch snapshot: ${response.statusText}`,
          502,
          "SNAPSHOT_FETCH_FAILED"
        );
      }

      // Update camera status and last_snapshot_at
      await c.env.DB.prepare(
        "UPDATE cameras SET is_online = 1, last_snapshot_at = ?, last_error = NULL, updated_at = ? WHERE id = ?"
      )
        .bind(now(), now(), cameraId)
        .run();

      // Return the image
      const contentType = response.headers.get("Content-Type") || "image/jpeg";
      const imageData = await response.arrayBuffer();

      return new Response(imageData, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Update camera status on error
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await c.env.DB.prepare(
        "UPDATE cameras SET is_online = 0, last_error = ?, updated_at = ? WHERE id = ?"
      )
        .bind(errorMessage, now(), cameraId)
        .run();

      throw new ApiError(
        `Failed to fetch snapshot: ${errorMessage}`,
        502,
        "SNAPSHOT_FETCH_FAILED"
      );
    }
  }
);

// =============================================================================
// DELETE CAMERA
// =============================================================================

/**
 * DELETE /api/v1/cameras/:id
 * Delete a camera
 */
cameras.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const cameraId = c.req.param("id");

    // Check camera exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM cameras WHERE id = ? AND tenant_id = ?"
    )
      .bind(cameraId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Camera not found", 404, "CAMERA_NOT_FOUND");
    }

    await c.env.DB.prepare(
      "DELETE FROM cameras WHERE id = ? AND tenant_id = ?"
    )
      .bind(cameraId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Camera deleted successfully",
    });
  }
);
