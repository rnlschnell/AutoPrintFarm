/**
 * Print Files Routes - File Upload, Metadata, and Thumbnail Management
 *
 * CRUD operations for print files, presigned URL generation, and version management.
 * All routes are tenant-scoped.
 *
 * Phase 6: Print Files & R2 Storage
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import {
  uploadFile,
  downloadFile,
  deleteFile,
  deleteFiles,
  printFilePath,
  getContentType,
  generateSignedUrlToken,
  verifySignedUrlToken,
  fileExists,
} from "../lib/r2";
import type { PrintFile, PrintFileVersion } from "../types";
import { parse3MF, validate3MF, getFileExtension } from "../lib/threemf";

export const files = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

const createFileSchema = z.object({
  name: z.string().min(1).max(255),
  r2_key: z.string().min(1),
  file_size_bytes: z.number().int().positive().optional(),
  product_id: z.string().optional(),
  number_of_units: z.number().int().min(1).default(1),
});

const updateFileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  product_id: z.string().nullable().optional(),
  number_of_units: z.number().int().min(1).optional(),
  // Metadata fields (typically set by background processing, but can be manually updated)
  print_time_seconds: z.number().int().positive().nullable().optional(),
  filament_weight_grams: z.number().positive().nullable().optional(),
  filament_length_meters: z.number().positive().nullable().optional(),
  filament_type: z.string().max(50).nullable().optional(),
  printer_model_id: z.string().max(50).nullable().optional(),
  nozzle_diameter: z.number().positive().nullable().optional(),
  layer_count: z.number().int().positive().nullable().optional(),
  curr_bed_type: z.string().max(50).nullable().optional(),
  default_print_profile: z.string().max(100).nullable().optional(),
  object_count: z.number().int().min(1).optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().optional(),
});

const createVersionSchema = z.object({
  r2_key: z.string().min(1),
  notes: z.string().max(500).optional(),
  set_as_current: z.boolean().default(true),
});

// =============================================================================
// PARSE METADATA (Client-side 3MF parsing for auto-detection)
// =============================================================================

/**
 * POST /api/v1/files/parse-metadata
 * Parse metadata from a 3MF file without storing it permanently.
 * Used during product file upload to extract printer model information for auto-detection.
 *
 * The file is parsed in memory and the metadata is returned immediately.
 * Only supports 3MF files as they contain printer model metadata.
 *
 * NOTE: This endpoint does NOT require authentication so it can be used
 * during product creation before files are formally uploaded.
 */
files.post("/parse-metadata", async (c) => {
  console.log("[parse-metadata] Request received");
  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("file");

    console.log("[parse-metadata] File from formData:", file ? "present" : "missing");

    // In Cloudflare Workers, files from formData are Blob-like objects with a name property
    if (!file || typeof file === "string") {
      console.log("[parse-metadata] No file provided or file is string");
      throw new ApiError("No file provided", 400, "NO_FILE");
    }

    // Cast to get proper typing - formData files in Workers are File-like
    const fileBlob = file as unknown as { name: string; arrayBuffer(): Promise<ArrayBuffer> };

    // Validate file type - only 3MF files contain metadata we can parse
    const fileExtension = getFileExtension(fileBlob.name);
    if (fileExtension !== "3mf") {
      throw new ApiError(
        "Only 3MF files can be parsed for metadata. Other file types (STL, GCODE, etc.) must be manually assigned to a printer model.",
        400,
        "INVALID_FILE_TYPE"
      );
    }

    // Read file data
    const arrayBuffer = await fileBlob.arrayBuffer();

    // Validate it's a valid 3MF (ZIP) file
    if (!validate3MF(arrayBuffer)) {
      throw new ApiError(
        "Invalid 3MF file. The file appears to be corrupted or not a valid 3MF.",
        400,
        "INVALID_3MF"
      );
    }

    // Parse the 3MF file
    const { metadata } = await parse3MF(arrayBuffer);

    // Check if we got a printer model
    if (!metadata.printerModelId) {
      console.log("[parse-metadata] No printer model ID found in metadata:", JSON.stringify(metadata));
      throw new ApiError(
        "Could not determine printer model from file. The file may not contain valid printer metadata.",
        400,
        "NO_PRINTER_MODEL"
      );
    }

    console.log(`[parse-metadata] Successfully parsed metadata from ${fileBlob.name}: printer_model_id=${metadata.printerModelId}`);

    return c.json({
      success: true,
      filename: fileBlob.name,
      printer_model_id: metadata.printerModelId,
      metadata: {
        print_time_seconds: metadata.printTimeSeconds,
        filament_weight_grams: metadata.filamentWeightGrams,
        filament_length_meters: metadata.filamentLengthMeters,
        filament_type: metadata.filamentType,
        printer_model_id: metadata.printerModelId,
        nozzle_diameter: metadata.nozzleDiameter,
        layer_count: metadata.layerCount,
        curr_bed_type: metadata.currBedType,
        default_print_profile: metadata.defaultPrintProfile,
        object_count: metadata.objectCount,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error("Failed to parse 3MF metadata:", error);
    throw new ApiError(
      `Failed to parse file metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
      500,
      "PARSE_ERROR"
    );
  }
});

// =============================================================================
// LIST FILES
// =============================================================================

/**
 * GET /api/v1/files
 * List all print files for the current tenant
 * Supports filtering by product_id, filament_type, printer_model_id
 */
files.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const productId = c.req.query("product_id");
  const filamentType = c.req.query("filament_type");
  const printerModelId = c.req.query("printer_model_id");
  const search = c.req.query("search");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  let query = "SELECT * FROM print_files WHERE tenant_id = ?";
  let countQuery = "SELECT COUNT(*) as count FROM print_files WHERE tenant_id = ?";
  const params: (string | number)[] = [tenantId];
  const countParams: (string | number)[] = [tenantId];

  if (productId) {
    query += " AND product_id = ?";
    countQuery += " AND product_id = ?";
    params.push(productId);
    countParams.push(productId);
  }

  if (filamentType) {
    query += " AND filament_type = ?";
    countQuery += " AND filament_type = ?";
    params.push(filamentType);
    countParams.push(filamentType);
  }

  if (printerModelId) {
    query += " AND printer_model_id = ?";
    countQuery += " AND printer_model_id = ?";
    params.push(printerModelId);
    countParams.push(printerModelId);
  }

  if (search) {
    query += " AND name LIKE ?";
    countQuery += " AND name LIKE ?";
    params.push(`%${search}%`);
    countParams.push(`%${search}%`);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const [result, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all<PrintFile>(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: result.results || [],
    meta: {
      total: countResult?.count || 0,
      limit,
      offset,
      hasMore: offset + (result.results?.length || 0) < (countResult?.count || 0),
    },
  });
});

// =============================================================================
// GET SINGLE FILE
// =============================================================================

/**
 * GET /api/v1/files/:id
 * Get a single print file by ID, including its versions
 */
files.get("/:id", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const fileId = c.req.param("id");

  const [file, versions] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM print_files WHERE id = ? AND tenant_id = ?")
      .bind(fileId, tenantId)
      .first<PrintFile>(),
    c.env.DB.prepare(
      "SELECT * FROM print_file_versions WHERE print_file_id = ? ORDER BY version_number DESC"
    )
      .bind(fileId)
      .all<PrintFileVersion>(),
  ]);

  if (!file) {
    throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: {
      ...file,
      versions: versions.results || [],
    },
  });
});

// =============================================================================
// GET UPLOAD URL
// =============================================================================

/**
 * POST /api/v1/files/upload-url
 * Generate a presigned URL for uploading a file
 * Returns the R2 key and a signed token for completing the upload
 */
files.post(
  "/upload-url",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof uploadUrlSchema>;
    try {
      const rawBody = await c.req.json();
      body = uploadUrlSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Generate a unique file ID for the upload
    const fileId = generateId();
    const r2Key = printFilePath(tenantId, fileId, body.filename);
    const contentType = body.content_type || getContentType(body.filename);

    // Generate a signed token that expires in 1 hour
    const uploadToken = await generateSignedUrlToken(r2Key, c.env.ENCRYPTION_KEY, {
      expiresIn: 3600, // 1 hour
      contentType,
    });

    return c.json({
      success: true,
      data: {
        file_id: fileId,
        r2_key: r2Key,
        upload_token: uploadToken,
        content_type: contentType,
        expires_in: 3600,
        // Direct upload URL (the client uploads directly to this endpoint with the token)
        upload_url: `/api/v1/files/upload/${uploadToken}`,
      },
    });
  }
);

// =============================================================================
// DIRECT UPLOAD (via token)
// =============================================================================

/**
 * PUT /api/v1/files/upload/:token
 * Upload a file directly using a presigned token
 * This allows direct file upload without going through the file creation flow
 */
files.put("/upload/:token", async (c) => {
  const token = c.req.param("token");

  // Verify the token
  const verification = await verifySignedUrlToken(token, c.env.ENCRYPTION_KEY);
  if (!verification.valid) {
    if (verification.expired) {
      throw new ApiError("Upload token has expired", 401, "TOKEN_EXPIRED");
    }
    throw new ApiError("Invalid upload token", 401, "INVALID_TOKEN");
  }

  const r2Key = verification.key!;

  // Get the request body as ArrayBuffer
  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    throw new ApiError("No file content provided", 400, "NO_CONTENT");
  }

  // Upload to R2
  const contentType = c.req.header("Content-Type") || "application/octet-stream";
  await uploadFile(c.env.R2, r2Key, body, { contentType });

  return c.json({
    success: true,
    data: {
      r2_key: r2Key,
      size_bytes: body.byteLength,
    },
  });
});

// =============================================================================
// CREATE FILE RECORD
// =============================================================================

/**
 * POST /api/v1/files
 * Create a new print file record (after upload completes)
 * This triggers background processing for metadata extraction
 */
files.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    let body: z.infer<typeof createFileSchema>;
    try {
      const rawBody = await c.req.json();
      body = createFileSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name
    const existing = await c.env.DB.prepare(
      "SELECT id FROM print_files WHERE tenant_id = ? AND name = ?"
    )
      .bind(tenantId, body.name)
      .first();

    if (existing) {
      throw new ApiError(
        "A file with this name already exists",
        409,
        "DUPLICATE_NAME"
      );
    }

    // Validate product_id if provided
    if (body.product_id) {
      const product = await c.env.DB.prepare(
        "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.product_id, tenantId)
        .first();

      if (!product) {
        throw new ApiError(
          "Product not found or does not belong to this tenant",
          404,
          "PRODUCT_NOT_FOUND"
        );
      }
    }

    // Verify the file exists in R2
    const exists = await fileExists(c.env.R2, body.r2_key);
    if (!exists) {
      throw new ApiError(
        "File not found in storage. Please upload the file first.",
        400,
        "FILE_NOT_UPLOADED"
      );
    }

    // Extract file ID from r2_key (format: {tenant_id}/files/{file_id}/{filename})
    const keyParts = body.r2_key.split("/");
    const fileId: string = keyParts.length >= 3 && keyParts[2] ? keyParts[2] : generateId();

    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO print_files (
        id, tenant_id, product_id, name, file_size_bytes, r2_key,
        number_of_units, object_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        fileId,
        tenantId,
        body.product_id || null,
        body.name,
        body.file_size_bytes || null,
        body.r2_key,
        body.number_of_units,
        1, // default object_count
        now,
        now
      )
      .run();

    // Create initial version (version 1)
    const versionId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO print_file_versions (
        id, print_file_id, version_number, r2_key, is_current_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(versionId, fileId, 1, body.r2_key, 1, now)
      .run();

    // Queue metadata extraction
    await c.env.FILE_PROCESSING.send({
      type: "extract_metadata",
      fileId,
      tenantId,
      timestamp: Date.now(),
    });

    // Fetch the created file
    const file = await c.env.DB.prepare("SELECT * FROM print_files WHERE id = ?")
      .bind(fileId)
      .first<PrintFile>();

    return c.json(
      {
        success: true,
        data: file,
        message: "File created. Metadata extraction queued.",
      },
      201
    );
  }
);

// =============================================================================
// UPDATE FILE
// =============================================================================

/**
 * PUT /api/v1/files/:id
 * Update a print file's metadata
 */
files.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const fileId = c.req.param("id");

    // Check file exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(fileId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
    }

    let body: z.infer<typeof updateFileSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateFileSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate name if name is being changed
    if (body.name) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM print_files WHERE tenant_id = ? AND name = ? AND id != ?"
      )
        .bind(tenantId, body.name, fileId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "A file with this name already exists",
          409,
          "DUPLICATE_NAME"
        );
      }
    }

    // Validate product_id if provided
    if (body.product_id) {
      const product = await c.env.DB.prepare(
        "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.product_id, tenantId)
        .first();

      if (!product) {
        throw new ApiError(
          "Product not found or does not belong to this tenant",
          404,
          "PRODUCT_NOT_FOUND"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const fields: Array<{ key: keyof typeof body; column: string }> = [
      { key: "name", column: "name" },
      { key: "product_id", column: "product_id" },
      { key: "number_of_units", column: "number_of_units" },
      { key: "print_time_seconds", column: "print_time_seconds" },
      { key: "filament_weight_grams", column: "filament_weight_grams" },
      { key: "filament_length_meters", column: "filament_length_meters" },
      { key: "filament_type", column: "filament_type" },
      { key: "printer_model_id", column: "printer_model_id" },
      { key: "nozzle_diameter", column: "nozzle_diameter" },
      { key: "layer_count", column: "layer_count" },
      { key: "curr_bed_type", column: "curr_bed_type" },
      { key: "default_print_profile", column: "default_print_profile" },
      { key: "object_count", column: "object_count" },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        values.push(body[field.key] as string | number | null);
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(fileId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE print_files SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated file
    const file = await c.env.DB.prepare("SELECT * FROM print_files WHERE id = ?")
      .bind(fileId)
      .first<PrintFile>();

    return c.json({
      success: true,
      data: file,
    });
  }
);

// =============================================================================
// DELETE FILE
// =============================================================================

/**
 * DELETE /api/v1/files/:id
 * Delete a print file (removes from R2 and D1)
 */
files.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const fileId = c.req.param("id");

    // Get the file to retrieve R2 keys
    const file = await c.env.DB.prepare(
      "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(fileId, tenantId)
      .first<PrintFile>();

    if (!file) {
      throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
    }

    // Get all versions to delete their R2 keys too
    const versions = await c.env.DB.prepare(
      "SELECT r2_key FROM print_file_versions WHERE print_file_id = ?"
    )
      .bind(fileId)
      .all<{ r2_key: string | null }>();

    // Collect all R2 keys to delete
    const keysToDelete: string[] = [];
    if (file.r2_key) keysToDelete.push(file.r2_key);
    if (file.thumbnail_r2_key) keysToDelete.push(file.thumbnail_r2_key);
    for (const version of versions.results || []) {
      if (version.r2_key && !keysToDelete.includes(version.r2_key)) {
        keysToDelete.push(version.r2_key);
      }
    }

    // Delete from R2 (ignore errors for missing files)
    if (keysToDelete.length > 0) {
      try {
        await deleteFiles(c.env.R2, keysToDelete);
      } catch (err) {
        // Log but don't fail if R2 deletion fails
        console.error("Failed to delete some R2 files:", err);
      }
    }

    // Delete versions and file from D1
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM print_file_versions WHERE print_file_id = ?").bind(
        fileId
      ),
      c.env.DB.prepare("DELETE FROM print_files WHERE id = ? AND tenant_id = ?").bind(
        fileId,
        tenantId
      ),
    ]);

    return c.json({
      success: true,
      message: "Print file deleted successfully",
    });
  }
);

// =============================================================================
// GET DOWNLOAD URL
// =============================================================================

/**
 * GET /api/v1/files/:id/download-url
 * Get a presigned download URL for the file
 */
files.get("/:id/download-url", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const fileId = c.req.param("id");
  const versionNumber = c.req.query("version");

  const file = await c.env.DB.prepare(
    "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first<PrintFile>();

  if (!file) {
    throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
  }

  let r2Key = file.r2_key;

  // If a specific version is requested, get that version's r2_key
  if (versionNumber) {
    const version = await c.env.DB.prepare(
      "SELECT r2_key FROM print_file_versions WHERE print_file_id = ? AND version_number = ?"
    )
      .bind(fileId, parseInt(versionNumber, 10))
      .first<{ r2_key: string | null }>();

    if (!version) {
      throw new ApiError("Version not found", 404, "VERSION_NOT_FOUND");
    }
    r2Key = version.r2_key;
  }

  if (!r2Key) {
    throw new ApiError("File not available for download", 400, "NO_R2_KEY");
  }

  // Generate signed download token (valid for 1 hour)
  const downloadToken = await generateSignedUrlToken(r2Key, c.env.ENCRYPTION_KEY, {
    expiresIn: 3600,
  });

  return c.json({
    success: true,
    data: {
      download_url: `/api/v1/files/download/${downloadToken}`,
      filename: file.name,
      expires_in: 3600,
    },
  });
});

// =============================================================================
// DIRECT DOWNLOAD (via token)
// =============================================================================

/**
 * GET /api/v1/files/download/:token
 * Download a file using a presigned token
 */
files.get("/download/:token", async (c) => {
  const token = c.req.param("token");

  // Verify the token
  const verification = await verifySignedUrlToken(token, c.env.ENCRYPTION_KEY);
  if (!verification.valid) {
    if (verification.expired) {
      throw new ApiError("Download link has expired", 401, "TOKEN_EXPIRED");
    }
    throw new ApiError("Invalid download link", 401, "INVALID_TOKEN");
  }

  const r2Key = verification.key!;

  // Download from R2
  const object = await downloadFile(c.env.R2, r2Key);

  // Extract filename from r2_key
  const filename = r2Key.split("/").pop() || "download";

  // Return the file
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": object.size.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// =============================================================================
// GET THUMBNAIL
// =============================================================================

/**
 * GET /api/v1/files/:id/thumbnail
 * Get the thumbnail for a print file
 */
files.get("/:id/thumbnail", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const fileId = c.req.param("id");

  const file = await c.env.DB.prepare(
    "SELECT thumbnail_r2_key FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first<{ thumbnail_r2_key: string | null }>();

  if (!file) {
    throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
  }

  if (!file.thumbnail_r2_key) {
    throw new ApiError("Thumbnail not available", 404, "NO_THUMBNAIL");
  }

  // Download thumbnail from R2
  const object = await downloadFile(c.env.R2, file.thumbnail_r2_key);

  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400", // Cache for 24 hours
    },
  });
});

// =============================================================================
// FILE VERSIONS
// =============================================================================

/**
 * GET /api/v1/files/:id/versions
 * List all versions of a print file
 */
files.get("/:id/versions", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const fileId = c.req.param("id");

  // Verify file exists and belongs to tenant
  const file = await c.env.DB.prepare(
    "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first();

  if (!file) {
    throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
  }

  const versions = await c.env.DB.prepare(
    "SELECT * FROM print_file_versions WHERE print_file_id = ? ORDER BY version_number DESC"
  )
    .bind(fileId)
    .all<PrintFileVersion>();

  return c.json({
    success: true,
    data: versions.results || [],
  });
});

/**
 * POST /api/v1/files/:id/versions
 * Add a new version to a print file (max 3 versions)
 */
files.post(
  "/:id/versions",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const fileId = c.req.param("id");

    // Verify file exists
    const file = await c.env.DB.prepare(
      "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(fileId, tenantId)
      .first<PrintFile>();

    if (!file) {
      throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
    }

    let body: z.infer<typeof createVersionSchema>;
    try {
      const rawBody = await c.req.json();
      body = createVersionSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Verify the file exists in R2
    const exists = await fileExists(c.env.R2, body.r2_key);
    if (!exists) {
      throw new ApiError(
        "File not found in storage. Please upload the file first.",
        400,
        "FILE_NOT_UPLOADED"
      );
    }

    // Check current version count
    const versionCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM print_file_versions WHERE print_file_id = ?"
    )
      .bind(fileId)
      .first<{ count: number }>();

    if ((versionCount?.count || 0) >= 3) {
      throw new ApiError(
        "Maximum of 3 versions allowed per file. Delete an existing version first.",
        400,
        "MAX_VERSIONS_REACHED"
      );
    }

    // Get next version number
    const maxVersion = await c.env.DB.prepare(
      "SELECT MAX(version_number) as max_version FROM print_file_versions WHERE print_file_id = ?"
    )
      .bind(fileId)
      .first<{ max_version: number | null }>();

    const newVersionNumber = (maxVersion?.max_version || 0) + 1;

    const versionId = generateId();
    const now = new Date().toISOString();

    // If set_as_current, unset current version on other versions
    if (body.set_as_current) {
      await c.env.DB.prepare(
        "UPDATE print_file_versions SET is_current_version = 0 WHERE print_file_id = ?"
      )
        .bind(fileId)
        .run();

      // Also update the main file's r2_key
      await c.env.DB.prepare(
        "UPDATE print_files SET r2_key = ?, updated_at = ? WHERE id = ?"
      )
        .bind(body.r2_key, now, fileId)
        .run();
    }

    // Insert new version
    await c.env.DB.prepare(
      `INSERT INTO print_file_versions (
        id, print_file_id, version_number, r2_key, notes, is_current_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        versionId,
        fileId,
        newVersionNumber,
        body.r2_key,
        body.notes || null,
        body.set_as_current ? 1 : 0,
        now
      )
      .run();

    // Queue metadata extraction for new version
    await c.env.FILE_PROCESSING.send({
      type: "extract_metadata",
      fileId,
      tenantId,
      timestamp: Date.now(),
    });

    const version = await c.env.DB.prepare(
      "SELECT * FROM print_file_versions WHERE id = ?"
    )
      .bind(versionId)
      .first<PrintFileVersion>();

    return c.json(
      {
        success: true,
        data: version,
        message: "Version added. Metadata extraction queued.",
      },
      201
    );
  }
);

/**
 * PUT /api/v1/files/:id/versions/:versionNumber/current
 * Set a specific version as the current version
 */
files.put(
  "/:id/versions/:versionNumber/current",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const fileId = c.req.param("id");
    const versionNumber = parseInt(c.req.param("versionNumber"), 10);

    // Verify file exists
    const file = await c.env.DB.prepare(
      "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(fileId, tenantId)
      .first();

    if (!file) {
      throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
    }

    // Get the target version
    const version = await c.env.DB.prepare(
      "SELECT * FROM print_file_versions WHERE print_file_id = ? AND version_number = ?"
    )
      .bind(fileId, versionNumber)
      .first<PrintFileVersion>();

    if (!version) {
      throw new ApiError("Version not found", 404, "VERSION_NOT_FOUND");
    }

    const now = new Date().toISOString();

    // Update versions and main file
    await c.env.DB.batch([
      // Unset current on all versions
      c.env.DB.prepare(
        "UPDATE print_file_versions SET is_current_version = 0 WHERE print_file_id = ?"
      ).bind(fileId),
      // Set current on target version
      c.env.DB.prepare(
        "UPDATE print_file_versions SET is_current_version = 1 WHERE id = ?"
      ).bind(version.id),
      // Update main file's r2_key
      c.env.DB.prepare(
        "UPDATE print_files SET r2_key = ?, updated_at = ? WHERE id = ?"
      ).bind(version.r2_key, now, fileId),
    ]);

    return c.json({
      success: true,
      message: `Version ${versionNumber} is now the current version`,
    });
  }
);

/**
 * DELETE /api/v1/files/:id/versions/:versionNumber
 * Delete a specific version (cannot delete the current version if it's the only one)
 */
files.delete(
  "/:id/versions/:versionNumber",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const fileId = c.req.param("id");
    const versionNumber = parseInt(c.req.param("versionNumber"), 10);

    // Verify file exists
    const file = await c.env.DB.prepare(
      "SELECT id FROM print_files WHERE id = ? AND tenant_id = ?"
    )
      .bind(fileId, tenantId)
      .first();

    if (!file) {
      throw new ApiError("Print file not found", 404, "FILE_NOT_FOUND");
    }

    // Get the version
    const version = await c.env.DB.prepare(
      "SELECT * FROM print_file_versions WHERE print_file_id = ? AND version_number = ?"
    )
      .bind(fileId, versionNumber)
      .first<PrintFileVersion>();

    if (!version) {
      throw new ApiError("Version not found", 404, "VERSION_NOT_FOUND");
    }

    // Check if this is the only version
    const versionCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM print_file_versions WHERE print_file_id = ?"
    )
      .bind(fileId)
      .first<{ count: number }>();

    if ((versionCount?.count || 0) <= 1) {
      throw new ApiError(
        "Cannot delete the only version. Delete the entire file instead.",
        400,
        "CANNOT_DELETE_ONLY_VERSION"
      );
    }

    // If deleting the current version, make another version current
    if (version.is_current_version) {
      const otherVersion = await c.env.DB.prepare(
        "SELECT * FROM print_file_versions WHERE print_file_id = ? AND version_number != ? ORDER BY version_number DESC LIMIT 1"
      )
        .bind(fileId, versionNumber)
        .first<PrintFileVersion>();

      if (otherVersion) {
        const now = new Date().toISOString();
        await c.env.DB.batch([
          c.env.DB.prepare(
            "UPDATE print_file_versions SET is_current_version = 1 WHERE id = ?"
          ).bind(otherVersion.id),
          c.env.DB.prepare(
            "UPDATE print_files SET r2_key = ?, updated_at = ? WHERE id = ?"
          ).bind(otherVersion.r2_key, now, fileId),
        ]);
      }
    }

    // Delete the R2 file if it's not shared by another version
    if (version.r2_key) {
      const sharedKey = await c.env.DB.prepare(
        "SELECT id FROM print_file_versions WHERE print_file_id = ? AND r2_key = ? AND id != ?"
      )
        .bind(fileId, version.r2_key, version.id)
        .first();

      if (!sharedKey) {
        try {
          await deleteFile(c.env.R2, version.r2_key);
        } catch (err) {
          console.error("Failed to delete R2 file:", err);
        }
      }
    }

    // Delete the version record
    await c.env.DB.prepare("DELETE FROM print_file_versions WHERE id = ?")
      .bind(version.id)
      .run();

    return c.json({
      success: true,
      message: `Version ${versionNumber} deleted successfully`,
    });
  }
);
