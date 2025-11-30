/**
 * Printer Routes - Printer Fleet Management
 *
 * CRUD operations for printers, status updates, and printer commands.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId, encryptAES256GCM, decryptAES256GCM } from "../lib/crypto";
import {
  addPrinterToHub,
  removePrinterFromHub,
  sendPrinterControl,
  isHubOnline,
} from "../lib/hub-commands";
import type { Printer, PrinterConnectionType } from "../types";

export const printers = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const printerStatusEnum = z.enum([
  "idle",
  "printing",
  "paused",
  "maintenance",
  "offline",
  "error",
]);

const connectionTypeEnum = z.enum([
  "bambu",
  "prusa",
  "octoprint",
  "klipper",
  "other",
]);

const createPrinterSchema = z.object({
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  manufacturer: z.string().max(100).optional(),
  hub_id: z.string().optional(),
  connection_type: connectionTypeEnum.default("bambu"),
  ip_address: z.string().max(45).optional(),
  serial_number: z.string().max(100).optional(),
  access_code: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  nozzle_size: z.number().min(0.1).max(2.0).optional(),
  current_build_plate: z.string().max(100).optional(),
});

const updatePrinterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  manufacturer: z.string().max(100).optional(),
  hub_id: z.string().nullable().optional(),
  connection_type: connectionTypeEnum.optional(),
  ip_address: z.string().max(45).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  access_code: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  nozzle_size: z.number().min(0.1).max(2.0).nullable().optional(),
  current_color: z.string().max(50).nullable().optional(),
  current_color_hex: z.string().max(7).nullable().optional(),
  current_filament_type: z.string().max(50).nullable().optional(),
  current_build_plate: z.string().max(100).nullable().optional(),
  filament_level: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
});

const updateStatusSchema = z.object({
  status: printerStatusEnum,
  connection_error: z.string().nullable().optional(),
});

const updateMaintenanceSchema = z.object({
  in_maintenance: z.boolean(),
  maintenance_type: z.string().max(100).nullable().optional(),
});

const batchUpdateOrderSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      sort_order: z.number().int().min(0),
    })
  ),
});

const controlCommandSchema = z.object({
  action: z.enum(["pause", "resume", "stop", "clear_bed"]),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Encrypt access code if provided
 */
async function encryptAccessCode(
  accessCode: string | null | undefined,
  encryptionKey: string
): Promise<string | null> {
  if (!accessCode) return null;
  return encryptAES256GCM(accessCode, encryptionKey);
}

/**
 * Decrypt access code for display/commands
 */
async function decryptAccessCode(
  encryptedCode: string | null,
  encryptionKey: string
): Promise<string | null> {
  if (!encryptedCode) return null;
  try {
    return await decryptAES256GCM(encryptedCode, encryptionKey);
  } catch {
    return null;
  }
}

/**
 * Get next available printer_id for a tenant
 */
async function getNextPrinterId(
  db: D1Database,
  tenantId: string
): Promise<number> {
  const result = await db
    .prepare(
      "SELECT COALESCE(MAX(printer_id), 0) + 1 as next_id FROM printers WHERE tenant_id = ?"
    )
    .bind(tenantId)
    .first<{ next_id: number }>();
  return result?.next_id || 1;
}

const MAX_PRINTERS_PER_HUB = 5;

/**
 * Find the best available hub for a new printer.
 * Strategy: Fill up hubs before moving to the next (most printers < 5, online only)
 * Returns null if no hubs have capacity.
 */
async function findBestAvailableHub(
  db: D1Database,
  tenantId: string
): Promise<{ id: string; printer_count: number } | null> {
  const hub = await db
    .prepare(
      `SELECT h.id,
        (SELECT COUNT(*) FROM printers WHERE hub_id = h.id) as printer_count
      FROM hubs h
      WHERE h.tenant_id = ?
        AND h.is_online = 1
      GROUP BY h.id
      HAVING printer_count < ?
      ORDER BY printer_count DESC
      LIMIT 1`
    )
    .bind(tenantId, MAX_PRINTERS_PER_HUB)
    .first<{ id: string; printer_count: number }>();

  return hub ?? null;
}

// =============================================================================
// LIST PRINTERS
// =============================================================================

/**
 * GET /api/v1/printers
 * List all printers for the current tenant
 * Supports filtering by hub_id, status, is_active
 */
printers.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const hubId = c.req.query("hub_id");
  const status = c.req.query("status");
  const isActive = c.req.query("is_active");

  let query = "SELECT * FROM printers WHERE tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (hubId) {
    query += " AND hub_id = ?";
    params.push(hubId);
  }

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  if (isActive !== undefined) {
    query += " AND is_active = ?";
    params.push(isActive === "true" ? 1 : 0);
  }

  query += " ORDER BY sort_order ASC, name ASC";

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<Printer>();

  // Don't return access codes in list view
  const sanitizedPrinters = (result.results || []).map((printer) => ({
    ...printer,
    access_code: printer.access_code ? "[ENCRYPTED]" : null,
  }));

  return c.json({
    success: true,
    data: sanitizedPrinters,
    meta: {
      total: sanitizedPrinters.length,
    },
  });
});

// =============================================================================
// GET SINGLE PRINTER
// =============================================================================

/**
 * GET /api/v1/printers/:id
 * Get a single printer by ID
 */
printers.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const printerId = c.req.param("id");

  const printer = await c.env.DB.prepare(
    "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
  )
    .bind(printerId, tenantId)
    .first<Printer>();

  if (!printer) {
    throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
  }

  // Only admins and owners can see decrypted access codes
  const userRole = c.get("userRole");
  let accessCodeDisplay: string | null = null;

  if (printer.access_code && ["owner", "admin"].includes(userRole!)) {
    accessCodeDisplay = await decryptAccessCode(
      printer.access_code,
      c.env.ENCRYPTION_KEY
    );
  } else if (printer.access_code) {
    accessCodeDisplay = "[ENCRYPTED]";
  }

  return c.json({
    success: true,
    data: {
      ...printer,
      access_code: accessCodeDisplay,
    },
  });
});

// =============================================================================
// CREATE PRINTER
// =============================================================================

/**
 * POST /api/v1/printers
 * Create a new printer
 */
printers.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof createPrinterSchema>;
    try {
      const rawBody = await c.req.json();
      body = createPrinterSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name
    const existing = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE tenant_id = ? AND name = ?"
    )
      .bind(tenantId, body.name)
      .first();

    if (existing) {
      throw new ApiError(
        "A printer with this name already exists",
        409,
        "DUPLICATE_NAME"
      );
    }

    // Auto-assign to best available hub (online, most filled but < 5 printers)
    const bestHub = await findBestAvailableHub(c.env.DB, tenantId);
    if (!bestHub) {
      throw new ApiError(
        "No hubs available with capacity. All hubs are either offline or at maximum capacity (5 printers).",
        503,
        "NO_AVAILABLE_HUB"
      );
    }

    // Use auto-assigned hub (ignore any hub_id from request body)
    const assignedHubId = bestHub.id;

    const printerId = generateId();
    const printerNumericId = await getNextPrinterId(c.env.DB, tenantId);
    const now = new Date().toISOString();

    // Encrypt access code if provided
    const encryptedAccessCode = await encryptAccessCode(
      body.access_code,
      c.env.ENCRYPTION_KEY
    );

    await c.env.DB.prepare(
      `INSERT INTO printers (
        id, tenant_id, hub_id, name, model, manufacturer,
        connection_type, ip_address, serial_number, access_code,
        location, nozzle_size, current_build_plate, printer_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        printerId,
        tenantId,
        assignedHubId,
        body.name,
        body.model,
        body.manufacturer || null,
        body.connection_type,
        body.ip_address || null,
        body.serial_number || null,
        encryptedAccessCode,
        body.location || null,
        body.nozzle_size || null,
        body.current_build_plate || null,
        printerNumericId,
        now,
        now
      )
      .run();

    // Fetch the created printer
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ?"
    )
      .bind(printerId)
      .first<Printer>();

    // Auto-connect: Hub is already assigned and online, try to connect if credentials provided
    let autoConnectResult: { attempted: boolean; success?: boolean; error?: string } = { attempted: false };

    if (printer && body.serial_number && body.ip_address && body.access_code) {
      try {
        // Hub is guaranteed online since we selected only online hubs
        // Decrypt access code to send to hub
        const accessCode = await decryptAccessCode(
          encryptedAccessCode,
          c.env.ENCRYPTION_KEY
        );

        const printerConfig: Parameters<typeof addPrinterToHub>[2] = {
          id: printerId,
          serial_number: body.serial_number,
          connection_type: body.connection_type as PrinterConnectionType,
        };
        if (accessCode) printerConfig.access_code = accessCode;
        if (body.ip_address) printerConfig.ip_address = body.ip_address;

        const result = await addPrinterToHub(
          c.env,
          assignedHubId,
          printerConfig,
          false // don't wait for acknowledgment - let it connect async
        );

        autoConnectResult = {
          attempted: true,
          success: result.success,
          ...(result.error ? { error: result.error } : {})
        };

        if (result.success) {
          // Mark printer as connection initiated
          await c.env.DB.prepare(
            `UPDATE printers SET last_connection_attempt = ?, updated_at = ? WHERE id = ?`
          )
            .bind(now, now, printerId)
            .run();
        }
      } catch (error) {
        // Don't fail printer creation if auto-connect fails
        console.error("[Printers] Auto-connect failed:", error);
        autoConnectResult = { attempted: true, success: false, error: "Auto-connect failed" };
      }
    }

    return c.json(
      {
        success: true,
        data: {
          ...printer,
          access_code: printer?.access_code ? "[ENCRYPTED]" : null,
        },
        assigned_hub: {
          id: assignedHubId,
          printer_count: bestHub.printer_count + 1, // Including this new printer
        },
        auto_connect: autoConnectResult,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE PRINTER
// =============================================================================

/**
 * PUT /api/v1/printers/:id
 * Update a printer's configuration
 */
printers.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Check printer exists
    const existing = await c.env.DB.prepare(
      "SELECT id, access_code FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first<{ id: string; access_code: string | null }>();

    if (!existing) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updatePrinterSchema>;
    try {
      const rawBody = await c.req.json();
      body = updatePrinterSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name if name is being changed
    if (body.name) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM printers WHERE tenant_id = ? AND name = ? AND id != ?"
      )
        .bind(tenantId, body.name, printerId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A printer with this name already exists",
          409,
          "DUPLICATE_NAME"
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
      { key: "model", column: "model" },
      { key: "manufacturer", column: "manufacturer" },
      { key: "hub_id", column: "hub_id" },
      { key: "connection_type", column: "connection_type" },
      { key: "ip_address", column: "ip_address" },
      { key: "serial_number", column: "serial_number" },
      { key: "location", column: "location" },
      { key: "nozzle_size", column: "nozzle_size" },
      { key: "current_color", column: "current_color" },
      { key: "current_color_hex", column: "current_color_hex" },
      { key: "current_filament_type", column: "current_filament_type" },
      { key: "current_build_plate", column: "current_build_plate" },
      { key: "filament_level", column: "filament_level" },
      { key: "is_active", column: "is_active", transform: (v) => (v ? 1 : 0) },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        const value = body[field.key];
        values.push(
          field.transform ? (field.transform(value) as string | number | null) : (value as string | number | null)
        );
      }
    }

    // Handle access_code specially (needs encryption)
    if (body.access_code !== undefined) {
      updates.push("access_code = ?");
      if (body.access_code === null) {
        values.push(null);
      } else {
        const encrypted = await encryptAccessCode(
          body.access_code,
          c.env.ENCRYPTION_KEY
        );
        values.push(encrypted);
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(printerId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE printers SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated printer
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ?"
    )
      .bind(printerId)
      .first<Printer>();

    // Auto-connect: If hub_id is being assigned and printer has connection credentials
    let autoConnectResult: { attempted: boolean; success?: boolean; error?: string } = { attempted: false };

    if (body.hub_id && printer && printer.serial_number && printer.ip_address && printer.access_code) {
      try {
        const hubOnline = await isHubOnline(c.env, body.hub_id);
        if (hubOnline) {
          // Decrypt access code to send to hub
          const accessCode = await decryptAccessCode(
            printer.access_code,
            c.env.ENCRYPTION_KEY
          );

          const printerConfig: Parameters<typeof addPrinterToHub>[2] = {
            id: printerId,
            serial_number: printer.serial_number,
            connection_type: printer.connection_type as PrinterConnectionType,
          };
          if (accessCode) printerConfig.access_code = accessCode;
          if (printer.ip_address) printerConfig.ip_address = printer.ip_address;

          const result = await addPrinterToHub(
            c.env,
            body.hub_id,
            printerConfig,
            false // don't wait for acknowledgment - let it connect async
          );

          autoConnectResult = {
            attempted: true,
            success: result.success,
            ...(result.error ? { error: result.error } : {})
          };

          if (result.success) {
            const now = new Date().toISOString();
            await c.env.DB.prepare(
              `UPDATE printers SET last_connection_attempt = ?, updated_at = ? WHERE id = ?`
            )
              .bind(now, now, printerId)
              .run();
          }
        }
      } catch (error) {
        console.error("[Printers] Auto-connect on update failed:", error);
        autoConnectResult = { attempted: true, success: false, error: "Auto-connect failed" };
      }
    }

    return c.json({
      success: true,
      data: {
        ...printer,
        access_code: printer?.access_code ? "[ENCRYPTED]" : null,
      },
      auto_connect: autoConnectResult,
    });
  }
);

// =============================================================================
// DELETE PRINTER
// =============================================================================

/**
 * DELETE /api/v1/printers/:id
 * Delete a printer
 */
printers.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Check printer exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    // Delete the printer
    await c.env.DB.prepare(
      "DELETE FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Printer deleted successfully",
    });
  }
);

// =============================================================================
// UPDATE PRINTER STATUS
// =============================================================================

/**
 * PUT /api/v1/printers/:id/status
 * Update printer status
 */
printers.put(
  "/:id/status",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Check printer exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateStatusSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateStatusSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE printers SET status = ?, connection_error = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(body.status, body.connection_error || null, now, printerId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Printer status updated",
      data: {
        id: printerId,
        status: body.status,
      },
    });
  }
);

// =============================================================================
// TOGGLE MAINTENANCE MODE
// =============================================================================

/**
 * PUT /api/v1/printers/:id/maintenance
 * Toggle maintenance mode
 */
printers.put(
  "/:id/maintenance",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Check printer exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateMaintenanceSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateMaintenanceSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    const now = new Date().toISOString();

    // Update maintenance status and optionally set status to 'maintenance'
    await c.env.DB.prepare(
      `UPDATE printers SET
        in_maintenance = ?,
        maintenance_type = ?,
        status = CASE WHEN ? = 1 THEN 'maintenance' ELSE status END,
        last_maintenance_date = CASE WHEN ? = 0 THEN ? ELSE last_maintenance_date END,
        updated_at = ?
      WHERE id = ? AND tenant_id = ?`
    )
      .bind(
        body.in_maintenance ? 1 : 0,
        body.maintenance_type || null,
        body.in_maintenance ? 1 : 0,
        body.in_maintenance ? 1 : 0,
        now,
        now,
        printerId,
        tenantId
      )
      .run();

    return c.json({
      success: true,
      message: body.in_maintenance
        ? "Printer is now in maintenance mode"
        : "Printer maintenance completed",
      data: {
        id: printerId,
        in_maintenance: body.in_maintenance,
        maintenance_type: body.maintenance_type,
      },
    });
  }
);

// =============================================================================
// MARK BED CLEARED
// =============================================================================

/**
 * PUT /api/v1/printers/:id/cleared
 * Mark printer bed as cleared
 */
printers.put(
  "/:id/cleared",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Check printer exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE printers SET cleared = 1, updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(now, printerId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Printer bed marked as cleared",
      data: {
        id: printerId,
        cleared: true,
      },
    });
  }
);

// =============================================================================
// BATCH UPDATE SORT ORDER
// =============================================================================

/**
 * PUT /api/v1/printers/order
 * Batch update sort order for multiple printers
 */
printers.put(
  "/order",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof batchUpdateOrderSchema>;
    try {
      const rawBody = await c.req.json();
      body = batchUpdateOrderSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    if (body.orders.length === 0) {
      throw new ApiError("No orders provided", 400, "NO_ORDERS");
    }

    const now = new Date().toISOString();

    // Build batch update statements
    const statements = body.orders.map((order) =>
      c.env.DB.prepare(
        `UPDATE printers SET sort_order = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
      ).bind(order.sort_order, now, order.id, tenantId)
    );

    // Execute batch
    await c.env.DB.batch(statements);

    return c.json({
      success: true,
      message: `Updated sort order for ${body.orders.length} printers`,
    });
  }
);

// =============================================================================
// PRINTER COMMANDS (via Hub)
// =============================================================================

/**
 * POST /api/v1/printers/:id/connect
 * Initiate connection to printer via hub
 */
printers.post(
  "/:id/connect",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Get printer with hub info
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    if (!printer.hub_id) {
      throw new ApiError(
        "Printer is not assigned to a hub",
        400,
        "NO_HUB_ASSIGNED"
      );
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, printer.hub_id);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Update connection attempt timestamp
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE printers SET last_connection_attempt = ?, connection_error = NULL, updated_at = ? WHERE id = ?`
    )
      .bind(now, now, printerId)
      .run();

    // Decrypt access code to send to hub
    const accessCode = await decryptAccessCode(
      printer.access_code,
      c.env.ENCRYPTION_KEY
    );

    // Send configure_printer command to hub
    const printerConfig: Parameters<typeof addPrinterToHub>[2] = {
      id: printer.id,
      serial_number: printer.serial_number || "",
      connection_type: printer.connection_type as PrinterConnectionType,
    };
    if (accessCode) printerConfig.access_code = accessCode;
    if (printer.ip_address) printerConfig.ip_address = printer.ip_address;

    const result = await addPrinterToHub(
      c.env,
      printer.hub_id,
      printerConfig,
      true // wait for acknowledgment
    );

    if (!result.success) {
      // Update with error
      await c.env.DB.prepare(
        `UPDATE printers SET connection_error = ?, updated_at = ? WHERE id = ?`
      )
        .bind(result.error || "Connection failed", now, printerId)
        .run();

      throw new ApiError(
        result.error || "Failed to connect printer",
        500,
        "CONNECT_FAILED"
      );
    }

    // Update printer as connected
    await c.env.DB.prepare(
      `UPDATE printers SET is_connected = 1, connection_error = NULL, updated_at = ? WHERE id = ?`
    )
      .bind(now, printerId)
      .run();

    return c.json({
      success: true,
      message: "Printer connected successfully",
      data: {
        command_id: result.command_id,
        printer_id: printerId,
        hub_id: printer.hub_id,
        status: "connected",
      },
    });
  }
);

/**
 * POST /api/v1/printers/:id/disconnect
 * Disconnect printer via hub
 */
printers.post(
  "/:id/disconnect",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Get printer
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    if (!printer.hub_id) {
      throw new ApiError(
        "Printer is not assigned to a hub",
        400,
        "NO_HUB_ASSIGNED"
      );
    }

    const now = new Date().toISOString();

    // Check if hub is online (if not, just mark disconnected locally)
    const hubOnline = await isHubOnline(c.env, printer.hub_id);

    if (hubOnline) {
      // Send configure_printer remove command to hub
      const result = await removePrinterFromHub(
        c.env,
        printer.hub_id,
        printer.id,
        printer.serial_number || "",
        printer.connection_type as PrinterConnectionType,
        false // don't wait for ack - printer may be unresponsive
      );

      // Update status
      await c.env.DB.prepare(
        `UPDATE printers SET is_connected = 0, updated_at = ? WHERE id = ?`
      )
        .bind(now, printerId)
        .run();

      return c.json({
        success: true,
        message: "Printer disconnected",
        data: {
          command_id: result.command_id,
          printer_id: printerId,
          hub_id: printer.hub_id,
          status: "disconnected",
        },
      });
    } else {
      // Hub offline - just update local status
      await c.env.DB.prepare(
        `UPDATE printers SET is_connected = 0, updated_at = ? WHERE id = ?`
      )
        .bind(now, printerId)
        .run();

      return c.json({
        success: true,
        message: "Printer marked as disconnected (hub offline)",
        data: {
          printer_id: printerId,
          hub_id: printer.hub_id,
          status: "disconnected",
          hub_offline: true,
        },
      });
    }
  }
);

/**
 * POST /api/v1/printers/:id/control
 * Send control command to printer (pause/resume/stop/clear_bed)
 */
printers.post(
  "/:id/control",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Parse and validate request body
    let body: z.infer<typeof controlCommandSchema>;
    try {
      const rawBody = await c.req.json();
      body = controlCommandSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Get printer
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    if (!printer.hub_id) {
      throw new ApiError(
        "Printer is not assigned to a hub",
        400,
        "NO_HUB_ASSIGNED"
      );
    }

    if (!printer.is_connected) {
      throw new ApiError("Printer is not connected", 400, "NOT_CONNECTED");
    }

    // Validate action makes sense for current status
    if (body.action === "pause" && printer.status !== "printing") {
      throw new ApiError(
        "Can only pause a printing printer",
        400,
        "INVALID_STATE"
      );
    }

    if (body.action === "resume" && printer.status !== "paused") {
      throw new ApiError(
        "Can only resume a paused printer",
        400,
        "INVALID_STATE"
      );
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, printer.hub_id);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Send printer_command to hub
    // Note: we use serial_number as printer_id for hub communication
    const result = await sendPrinterControl(
      c.env,
      printer.hub_id,
      printer.serial_number || printer.id,
      body.action,
      true // wait for acknowledgment
    );

    if (!result.success) {
      throw new ApiError(
        result.error || `Failed to ${body.action} printer`,
        500,
        "COMMAND_FAILED"
      );
    }

    // Update printer status based on action
    const now = new Date().toISOString();
    let newStatus = printer.status;
    if (body.action === "pause") {
      newStatus = "paused";
    } else if (body.action === "resume") {
      newStatus = "printing";
    } else if (body.action === "stop") {
      newStatus = "idle";
    }

    if (newStatus !== printer.status) {
      await c.env.DB.prepare(
        `UPDATE printers SET status = ?, updated_at = ? WHERE id = ?`
      )
        .bind(newStatus, now, printerId)
        .run();
    }

    return c.json({
      success: true,
      message: `${body.action} command sent successfully`,
      data: {
        command_id: result.command_id,
        printer_id: printerId,
        hub_id: printer.hub_id,
        action: body.action,
        status: newStatus,
      },
    });
  }
);

// =============================================================================
// LIGHT CONTROL
// =============================================================================

/**
 * POST /api/v1/printers/:id/light
 * Toggle printer light on/off
 */
printers.post(
  "/:id/light",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const printerId = c.req.param("id");

    // Parse request body
    let action: "light_on" | "light_off";
    try {
      const body = await c.req.json();
      if (body.state === true || body.state === "on") {
        action = "light_on";
      } else if (body.state === false || body.state === "off") {
        action = "light_off";
      } else {
        throw new ApiError("Invalid state - must be true/false or 'on'/'off'", 400, "INVALID_STATE");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Get printer
    const printer = await c.env.DB.prepare(
      "SELECT * FROM printers WHERE id = ? AND tenant_id = ?"
    )
      .bind(printerId, tenantId)
      .first<Printer>();

    if (!printer) {
      throw new ApiError("Printer not found", 404, "PRINTER_NOT_FOUND");
    }

    if (!printer.hub_id) {
      throw new ApiError(
        "Printer is not assigned to a hub",
        400,
        "NO_HUB_ASSIGNED"
      );
    }

    // Check if hub is online
    const hubOnline = await isHubOnline(c.env, printer.hub_id);
    if (!hubOnline) {
      throw new ApiError(
        "Hub is offline or not connected",
        503,
        "HUB_OFFLINE"
      );
    }

    // Send light command to hub
    const result = await sendPrinterControl(
      c.env,
      printer.hub_id,
      printer.serial_number || printer.id,
      action,
      false // don't wait for ack - light command is fire and forget
    );

    if (!result.success) {
      throw new ApiError(
        result.error || "Failed to control light",
        500,
        "COMMAND_FAILED"
      );
    }

    return c.json({
      success: true,
      message: `Light ${action === "light_on" ? "on" : "off"} command sent`,
      data: {
        command_id: result.command_id,
        printer_id: printerId,
        state: action === "light_on",
      },
    });
  }
);
