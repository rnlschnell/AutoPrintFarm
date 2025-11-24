/**
 * File Processing Queue Consumer
 *
 * Handles background processing tasks for print files:
 * - Metadata extraction from 3MF files
 * - Thumbnail extraction/generation
 * - File validation
 *
 * Phase 6: Print Files & R2 Storage
 */

import type { Env, FileProcessingMessage } from "../types/env";
import type { PrintFile } from "../types";
import { downloadFileAsBuffer, uploadFile, thumbnailPath } from "../lib/r2";
import { parse3MF, validate3MF, getFileExtension } from "../lib/threemf";

// =============================================================================
// QUEUE CONSUMER HANDLER
// =============================================================================

/**
 * Main queue consumer for file processing messages
 */
export async function handleFileProcessingQueue(
  batch: MessageBatch<FileProcessingMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processMessage(message.body, env);
      message.ack();
    } catch (error) {
      console.error(
        `Error processing message for file ${message.body.fileId}:`,
        error
      );

      // Retry up to 3 times, then dead-letter
      if (message.attempts < 3) {
        message.retry({ delaySeconds: Math.pow(2, message.attempts) * 10 });
      } else {
        console.error(
          `Max retries reached for file ${message.body.fileId}, acknowledging to prevent infinite loop`
        );
        message.ack();
      }
    }
  }
}

/**
 * Process a single message based on its type
 */
async function processMessage(
  message: FileProcessingMessage,
  env: Env
): Promise<void> {
  const { type, fileId, tenantId } = message;

  switch (type) {
    case "extract_metadata":
      await extractMetadata(fileId, tenantId, env);
      break;

    case "generate_thumbnail":
      await generateThumbnail(fileId, tenantId, env);
      break;

    case "validate_file":
      await validateFile(fileId, tenantId, env);
      break;

    default:
      console.warn(`Unknown message type: ${type}`);
  }
}

// =============================================================================
// METADATA EXTRACTION
// =============================================================================

/**
 * Extract metadata from a 3MF file and update the database record
 */
async function extractMetadata(
  fileId: string,
  tenantId: string,
  env: Env
): Promise<void> {
  console.log(`Extracting metadata for file ${fileId}`);

  // Get the file record
  const file = await env.DB.prepare(
    "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first<PrintFile>();

  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!file.r2_key) {
    throw new Error(`File has no R2 key: ${fileId}`);
  }

  // Check file extension
  const extension = getFileExtension(file.name);
  if (extension !== "3mf") {
    console.log(`File ${fileId} is not a 3MF file (${extension}), skipping metadata extraction`);
    return;
  }

  // Download the file from R2
  const fileData = await downloadFileAsBuffer(env.R2, file.r2_key);

  // Validate it's a valid 3MF
  if (!validate3MF(fileData)) {
    console.error(`File ${fileId} is not a valid 3MF file`);
    return;
  }

  // Parse the 3MF file
  const result = await parse3MF(fileData);
  const { metadata, thumbnail } = result;

  // Build update query
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (metadata.printTimeSeconds !== null) {
    updates.push("print_time_seconds = ?");
    values.push(metadata.printTimeSeconds);
  }

  if (metadata.filamentWeightGrams !== null) {
    updates.push("filament_weight_grams = ?");
    values.push(metadata.filamentWeightGrams);
  }

  if (metadata.filamentLengthMeters !== null) {
    updates.push("filament_length_meters = ?");
    values.push(metadata.filamentLengthMeters);
  }

  if (metadata.layerCount !== null) {
    updates.push("layer_count = ?");
    values.push(metadata.layerCount);
  }

  if (metadata.filamentType !== null) {
    updates.push("filament_type = ?");
    values.push(metadata.filamentType);
  }

  if (metadata.printerModelId !== null) {
    updates.push("printer_model_id = ?");
    values.push(metadata.printerModelId);
  }

  if (metadata.nozzleDiameter !== null) {
    updates.push("nozzle_diameter = ?");
    values.push(metadata.nozzleDiameter);
  }

  if (metadata.currBedType !== null) {
    updates.push("curr_bed_type = ?");
    values.push(metadata.currBedType);
  }

  if (metadata.defaultPrintProfile !== null) {
    updates.push("default_print_profile = ?");
    values.push(metadata.defaultPrintProfile);
  }

  if (metadata.objectCount > 0) {
    updates.push("object_count = ?");
    values.push(metadata.objectCount);
  }

  // Upload thumbnail if found
  if (thumbnail) {
    const thumbKey = thumbnailPath(tenantId, fileId);
    // Convert Uint8Array to ArrayBuffer for uploadFile
    const thumbnailBuffer = new Uint8Array(thumbnail.data).buffer as ArrayBuffer;
    await uploadFile(env.R2, thumbKey, thumbnailBuffer, {
      contentType: thumbnail.contentType,
      cacheControl: "public, max-age=31536000", // Cache for 1 year
    });

    updates.push("thumbnail_r2_key = ?");
    values.push(thumbKey);
    console.log(`Uploaded thumbnail for file ${fileId}`);
  }

  // Update the database record
  if (updates.length > 0) {
    updates.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(fileId);
    values.push(tenantId);

    await env.DB.prepare(
      `UPDATE print_files SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    console.log(`Updated metadata for file ${fileId}: ${updates.length} fields`);
  } else {
    console.log(`No metadata extracted for file ${fileId}`);
  }
}

// =============================================================================
// THUMBNAIL GENERATION
// =============================================================================

/**
 * Generate or extract a thumbnail for a print file
 */
async function generateThumbnail(
  fileId: string,
  tenantId: string,
  env: Env
): Promise<void> {
  console.log(`Generating thumbnail for file ${fileId}`);

  // Get the file record
  const file = await env.DB.prepare(
    "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first<PrintFile>();

  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!file.r2_key) {
    throw new Error(`File has no R2 key: ${fileId}`);
  }

  // Skip if thumbnail already exists
  if (file.thumbnail_r2_key) {
    console.log(`Thumbnail already exists for file ${fileId}`);
    return;
  }

  // Check file extension
  const extension = getFileExtension(file.name);
  if (extension !== "3mf") {
    console.log(`File ${fileId} is not a 3MF file, cannot extract thumbnail`);
    return;
  }

  // Download and parse
  const fileData = await downloadFileAsBuffer(env.R2, file.r2_key);
  const result = await parse3MF(fileData);

  if (result.thumbnail) {
    const thumbKey = thumbnailPath(tenantId, fileId);
    // Convert Uint8Array to ArrayBuffer for uploadFile
    const thumbnailBuffer = new Uint8Array(result.thumbnail.data).buffer as ArrayBuffer;
    await uploadFile(env.R2, thumbKey, thumbnailBuffer, {
      contentType: result.thumbnail.contentType,
      cacheControl: "public, max-age=31536000",
    });

    // Update database
    await env.DB.prepare(
      "UPDATE print_files SET thumbnail_r2_key = ?, updated_at = ? WHERE id = ? AND tenant_id = ?"
    )
      .bind(thumbKey, new Date().toISOString(), fileId, tenantId)
      .run();

    console.log(`Generated thumbnail for file ${fileId}`);
  } else {
    console.log(`No thumbnail found in 3MF file ${fileId}`);
  }
}

// =============================================================================
// FILE VALIDATION
// =============================================================================

/**
 * Validate a print file
 */
async function validateFile(
  fileId: string,
  tenantId: string,
  env: Env
): Promise<void> {
  console.log(`Validating file ${fileId}`);

  // Get the file record
  const file = await env.DB.prepare(
    "SELECT * FROM print_files WHERE id = ? AND tenant_id = ?"
  )
    .bind(fileId, tenantId)
    .first<PrintFile>();

  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!file.r2_key) {
    throw new Error(`File has no R2 key: ${fileId}`);
  }

  // Check file extension
  const extension = getFileExtension(file.name);

  if (extension === "3mf") {
    // Download and validate
    const fileData = await downloadFileAsBuffer(env.R2, file.r2_key);
    const isValid = validate3MF(fileData);

    if (!isValid) {
      console.error(`File ${fileId} is not a valid 3MF file`);
      // Could mark the file as invalid in the database here
    } else {
      console.log(`File ${fileId} is a valid 3MF file`);
    }
  } else if (extension === "gcode") {
    // Basic G-code validation (just check it's text)
    const fileData = await downloadFileAsBuffer(env.R2, file.r2_key);
    const text = new TextDecoder().decode(fileData.slice(0, 1000));

    // Check for common G-code commands
    const hasGCode = /[GM]\d+/i.test(text);
    if (hasGCode) {
      console.log(`File ${fileId} appears to be valid G-code`);
    } else {
      console.warn(`File ${fileId} may not be valid G-code`);
    }
  } else {
    console.log(`File ${fileId} has unsupported extension: ${extension}`);
  }
}

// =============================================================================
// EXPORT
// =============================================================================

export default {
  async queue(
    batch: MessageBatch<FileProcessingMessage>,
    env: Env
  ): Promise<void> {
    await handleFileProcessingQueue(batch, env);
  },
};
