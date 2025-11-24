/**
 * Temporary file manager for handling file uploads before they are saved to the server.
 * Files are stored in memory with their object URLs for preview purposes.
 */

interface TempFile {
  id: string;
  file: File;
  objectUrl: string;
  createdAt: number;
}

class TempFileManager {
  private files: Map<string, TempFile> = new Map();

  /**
   * Add a file to temporary storage
   */
  add(id: string, file: File): string {
    // Revoke any existing URL for this ID
    this.remove(id);

    const objectUrl = URL.createObjectURL(file);
    this.files.set(id, {
      id,
      file,
      objectUrl,
      createdAt: Date.now(),
    });

    return objectUrl;
  }

  /**
   * Get a temporary file by ID
   */
  get(id: string): TempFile | undefined {
    return this.files.get(id);
  }

  /**
   * Get the file object by ID
   */
  getFile(id: string): File | undefined {
    return this.files.get(id)?.file;
  }

  /**
   * Get the object URL for a file by ID
   */
  getUrl(id: string): string | undefined {
    return this.files.get(id)?.objectUrl;
  }

  /**
   * Check if a file exists in temporary storage
   */
  has(id: string): boolean {
    return this.files.has(id);
  }

  /**
   * Remove a file from temporary storage and revoke its object URL
   */
  remove(id: string): void {
    const tempFile = this.files.get(id);
    if (tempFile) {
      URL.revokeObjectURL(tempFile.objectUrl);
      this.files.delete(id);
    }
  }

  /**
   * Clear all temporary files
   */
  clear(): void {
    for (const tempFile of this.files.values()) {
      URL.revokeObjectURL(tempFile.objectUrl);
    }
    this.files.clear();
  }

  /**
   * Get all temporary file IDs
   */
  getAllIds(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Clean up files older than the specified age (in milliseconds)
   */
  cleanupOld(maxAge: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, tempFile] of this.files.entries()) {
      if (now - tempFile.createdAt > maxAge) {
        this.remove(id);
      }
    }
  }

  /**
   * Process temporary print files by uploading them to the server
   * Returns a map of temp file IDs to uploaded file IDs
   */
  async processTempPrintFiles(tenantId: string): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    for (const [tempId, tempFile] of this.files.entries()) {
      try {
        // Step 1: Get upload URL
        const uploadUrlResponse = await fetch('/api/v1/files/upload-url', {
          method: 'POST',
          credentials: 'include', // Important: send cookies for auth
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
          },
          body: JSON.stringify({
            filename: tempFile.file.name,
            content_type: tempFile.file.type || 'application/octet-stream',
          }),
        });

        if (!uploadUrlResponse.ok) {
          throw new Error(`Failed to get upload URL: ${uploadUrlResponse.statusText}`);
        }

        const uploadUrlData = await uploadUrlResponse.json();

        // Step 2: Upload file
        const uploadResponse = await fetch(uploadUrlData.data.upload_url, {
          method: 'PUT',
          headers: {
            'Content-Type': uploadUrlData.data.content_type,
          },
          body: tempFile.file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
        }

        // Step 3: Create file record
        const createFileResponse = await fetch('/api/v1/files', {
          method: 'POST',
          credentials: 'include', // Important: send cookies for auth
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
          },
          body: JSON.stringify({
            name: tempFile.file.name,
            r2_key: uploadUrlData.data.r2_key,
            file_size_bytes: tempFile.file.size,
          }),
        });

        if (!createFileResponse.ok) {
          throw new Error(`Failed to create file record: ${createFileResponse.statusText}`);
        }

        const createFileData = await createFileResponse.json();
        results.set(tempId, createFileData.data.id);

        // Clean up temp file after successful upload
        this.remove(tempId);
      } catch (error) {
        console.error(`Failed to upload temp file ${tempId}:`, error);
        throw error;
      }
    }

    return results;
  }
}

// Export a singleton instance
export const tempFileManager = new TempFileManager();
