/**
 * PrintFarm Cloud - R2 Storage Helpers
 *
 * Utility functions for R2 object storage operations including
 * file uploads, downloads, and tenant-scoped path management.
 */

import type { R2Bucket, R2Object, R2ObjectBody } from "@cloudflare/workers-types";

// =============================================================================
// ERROR TYPES
// =============================================================================

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class FileNotFoundError extends StorageError {
  constructor(key: string) {
    super(`File not found: ${key}`, "FILE_NOT_FOUND");
  }
}

// =============================================================================
// PATH HELPERS
// =============================================================================

/**
 * Build a tenant-scoped path for R2 storage
 * Format: {tenant_id}/{category}/{filename}
 */
export function tenantPath(
  tenantId: string,
  category: "files" | "thumbnails" | "images" | "exports",
  filename: string
): string {
  return `${tenantId}/${category}/${filename}`;
}

/**
 * Build a path for print files
 */
export function printFilePath(tenantId: string, fileId: string, filename: string): string {
  return tenantPath(tenantId, "files", `${fileId}/${filename}`);
}

/**
 * Build a path for thumbnails
 */
export function thumbnailPath(tenantId: string, fileId: string): string {
  return tenantPath(tenantId, "thumbnails", `${fileId}.png`);
}

/**
 * Build a path for product images
 */
export function productImagePath(tenantId: string, productId: string, extension = "jpg"): string {
  return tenantPath(tenantId, "images", `products/${productId}.${extension}`);
}

/**
 * Extract tenant ID from an R2 key
 */
export function extractTenantFromKey(key: string): string | null {
  const parts = key.split("/");
  return parts.length > 0 && parts[0] ? parts[0] : null;
}

// =============================================================================
// UPLOAD OPERATIONS
// =============================================================================

export interface UploadOptions {
  contentType?: string;
  customMetadata?: Record<string, string>;
  cacheControl?: string;
}

/**
 * Upload a file to R2
 */
export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer | ReadableStream | string,
  options: UploadOptions = {}
): Promise<R2Object> {
  try {
    const httpMetadata: Record<string, string> = {
      contentType: options.contentType ?? "application/octet-stream",
    };
    if (options.cacheControl) {
      httpMetadata.cacheControl = options.cacheControl;
    }

    const putOptions: { httpMetadata: Record<string, string>; customMetadata?: Record<string, string> } = {
      httpMetadata,
    };
    if (options.customMetadata) {
      putOptions.customMetadata = options.customMetadata;
    }

    const result = await bucket.put(key, body, putOptions);

    if (!result) {
      throw new StorageError(`Failed to upload file: ${key}`, "UPLOAD_FAILED");
    }

    return result;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(
      `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      "UPLOAD_ERROR",
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Upload a file with tenant scoping
 */
export async function uploadTenantFile(
  bucket: R2Bucket,
  tenantId: string,
  category: "files" | "thumbnails" | "images" | "exports",
  filename: string,
  body: ArrayBuffer | ReadableStream | string,
  options: UploadOptions = {}
): Promise<R2Object> {
  const key = tenantPath(tenantId, category, filename);
  return uploadFile(bucket, key, body, options);
}

// =============================================================================
// DOWNLOAD OPERATIONS
// =============================================================================

/**
 * Download a file from R2
 */
export async function downloadFile(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody> {
  const object = await bucket.get(key);

  if (!object) {
    throw new FileNotFoundError(key);
  }

  return object;
}

/**
 * Download a file and return as ArrayBuffer
 */
export async function downloadFileAsBuffer(
  bucket: R2Bucket,
  key: string
): Promise<ArrayBuffer> {
  const object = await downloadFile(bucket, key);
  return object.arrayBuffer();
}

/**
 * Download a file and return as text
 */
export async function downloadFileAsText(
  bucket: R2Bucket,
  key: string
): Promise<string> {
  const object = await downloadFile(bucket, key);
  return object.text();
}

/**
 * Get file metadata without downloading content
 */
export async function getFileHead(
  bucket: R2Bucket,
  key: string
): Promise<R2Object | null> {
  return bucket.head(key);
}

/**
 * Check if a file exists
 */
export async function fileExists(bucket: R2Bucket, key: string): Promise<boolean> {
  const head = await bucket.head(key);
  return head !== null;
}

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * Delete a file from R2
 */
export async function deleteFile(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * Delete multiple files from R2
 */
export async function deleteFiles(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await bucket.delete(keys);
}

/**
 * Delete all files with a given prefix (e.g., all files for a tenant)
 */
export async function deleteByPrefix(
  bucket: R2Bucket,
  prefix: string
): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const listed = await bucket.list(listOptions);

    if (listed.objects.length > 0) {
      const keys = listed.objects.map((obj) => obj.key);
      await bucket.delete(keys);
      deleted += keys.length;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return deleted;
}

// =============================================================================
// LIST OPERATIONS
// =============================================================================

export interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  delimiter?: string;
}

export interface ListResult {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

/**
 * List files in R2
 */
export async function listFiles(
  bucket: R2Bucket,
  options: ListOptions = {}
): Promise<ListResult> {
  const listOpts: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  } = {
    limit: options.limit ?? 1000,
  };

  if (options.prefix) listOpts.prefix = options.prefix;
  if (options.cursor) listOpts.cursor = options.cursor;
  if (options.delimiter) listOpts.delimiter = options.delimiter;

  const result = await bucket.list(listOpts);

  const listResult: ListResult = {
    objects: result.objects,
    truncated: result.truncated,
    delimitedPrefixes: result.delimitedPrefixes,
  };

  if (result.truncated && result.cursor) {
    listResult.cursor = result.cursor;
  }

  return listResult;
}

/**
 * List all files for a tenant
 */
export async function listTenantFiles(
  bucket: R2Bucket,
  tenantId: string,
  category?: "files" | "thumbnails" | "images" | "exports"
): Promise<R2Object[]> {
  const prefix = category ? `${tenantId}/${category}/` : `${tenantId}/`;
  const allObjects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const opts: ListOptions = { prefix };
    if (cursor) opts.cursor = cursor;
    const result = await listFiles(bucket, opts);
    allObjects.push(...result.objects);
    cursor = result.cursor;
  } while (cursor);

  return allObjects;
}

// =============================================================================
// PRESIGNED URL HELPERS
// =============================================================================

/**
 * Note: Cloudflare R2 presigned URLs require using the S3 API compatibility layer.
 * For Workers, we typically serve files directly through the Worker or use
 * signed URLs via a custom implementation.
 *
 * These helpers create URLs that can be verified by the Worker.
 */

export interface SignedUrlOptions {
  expiresIn: number; // seconds
  contentType?: string;
}

/**
 * Generate a signed URL token for file access
 * This creates a token that can be verified by the Worker to grant access
 */
export async function generateSignedUrlToken(
  key: string,
  secret: string,
  options: SignedUrlOptions
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + options.expiresIn;
  const message = `${key}:${expiresAt}`;

  // Generate HMAC signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // Create token: base64(key:expiresAt:signature)
  const token = btoa(`${key}:${expiresAt}:${signatureBase64}`);
  return token;
}

/**
 * Verify a signed URL token
 */
export async function verifySignedUrlToken(
  token: string,
  secret: string
): Promise<{ valid: boolean; key?: string; expired?: boolean }> {
  try {
    const decoded = atob(token);
    const parts = decoded.split(":");
    const key = parts[0];
    const expiresAtStr = parts[1];
    const signatureBase64 = parts[2];

    if (!key || !expiresAtStr || !signatureBase64) {
      return { valid: false };
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt)) {
      return { valid: false };
    }

    // Check expiration
    if (Math.floor(Date.now() / 1000) > expiresAt) {
      return { valid: false, expired: true };
    }

    // Verify signature
    const message = `${key}:${expiresAt}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Decode the signature
    const signatureBytes = Uint8Array.from(atob(signatureBase64), (c) =>
      c.charCodeAt(0)
    );

    const isValid = await crypto.subtle.verify("HMAC", cryptoKey, signatureBytes, msgData);

    if (isValid) {
      return { valid: true, key };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

// =============================================================================
// CONTENT TYPE HELPERS
// =============================================================================

const CONTENT_TYPES: Record<string, string> = {
  ".3mf": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  ".gcode": "text/plain",
  ".stl": "application/sla",
  ".obj": "application/x-tgif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * Get content type from filename extension
 */
export function getContentType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Get file extension from content type
 */
export function getExtension(contentType: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (type === contentType) return ext;
  }
  return "";
}
