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
}

// Export a singleton instance
export const tempFileManager = new TempFileManager();
