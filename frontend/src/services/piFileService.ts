export interface PiUploadResponse {
  success: boolean;
  file_path?: string;
  message?: string;
}

export class PiFileService {
  private readonly PI_BASE_URL: string;

  constructor() {
    // If we're running on the Pi (same host), use localhost for better performance and avoid CORS
    // Otherwise use the Pi's IP address
    const currentHost = window.location.hostname;
    if (currentHost === '192.168.4.45' || currentHost === 'localhost' || currentHost === '127.0.0.1') {
      this.PI_BASE_URL = `${window.location.protocol}//${window.location.host}`;
    } else {
      this.PI_BASE_URL = 'http://192.168.4.45:8080';
    }
    console.log(`[PiFileService] Initialized with base URL: ${this.PI_BASE_URL}`);
  }

  async uploadFile(file: File, printFileId: string): Promise<string> {
    // Pre-upload validation
    const allowedExtensions = ['.3mf', '.stl', '.gcode', '.obj', '.amf'];
    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));
    
    if (!allowedExtensions.includes(fileExtension)) {
      console.error(`[PiFileService] Invalid file type: ${fileExtension}`);
      throw new Error(`Invalid file type. Supported formats: ${allowedExtensions.join(', ')}`);
    }
    
    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024; // 100MB in bytes
    if (file.size > maxSize) {
      console.error(`[PiFileService] File too large: ${file.size} bytes`);
      throw new Error(`File size exceeds 100MB limit. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
    }
    
    const formData = new FormData();
    formData.append('file', file);

    console.log(`[PiFileService] Attempting to upload file to Pi: ${printFileId}, size: ${file.size} bytes, type: ${fileExtension}`);
    console.log(`[PiFileService] Using URL: ${this.PI_BASE_URL}/api/file-operations/upload/${printFileId}`);

    // Test connection first
    const isConnected = await this.checkConnection();
    if (!isConnected) {
      console.warn('[PiFileService] Pi is not reachable - file will be synced later from Supabase');
      throw new Error('Cannot reach Pi API - please check network connection');
    }

    try {
      const response = await fetch(`${this.PI_BASE_URL}/api/file-operations/upload/${printFileId}`, {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type - let browser set it with boundary for FormData
        }
      });

      console.log(`[PiFileService] Upload response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        console.error(`[PiFileService] Upload failed with status ${response.status}:`, errorText);
        
        // Provide user-friendly error messages
        if (response.status === 400 && errorText.includes('File must be')) {
          throw new Error('Invalid file format for Pi storage');
        } else if (response.status === 413) {
          throw new Error('File too large for Pi storage');
        } else if (response.status >= 500) {
          throw new Error('Pi server error - file saved to cloud, will sync later');
        } else {
          throw new Error(`Pi upload failed (${response.status}) - file saved to cloud`);
        }
      }

      const result: PiUploadResponse = await response.json();
      console.log(`[PiFileService] Upload result:`, result);
      
      if (!result.success) {
        throw new Error(`Pi upload failed: ${result.message || 'Unknown error'}`);
      }

      console.log(`[PiFileService] Upload successful, file path: ${result.file_path}`);
      return result.file_path || '';
    } catch (error) {
      console.error(`[PiFileService] Upload error:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Unable to connect to Pi - check network connection and Pi availability');
      }
      throw error;
    }
  }

  async replaceFile(file: File, printFileId: string): Promise<string> {
    // Same as upload - the Pi API handles replacement automatically
    return this.uploadFile(file, printFileId);
  }

  async deleteFile(printFileId: string): Promise<void> {
    try {
      const response = await fetch(`${this.PI_BASE_URL}/api/file-operations/${printFileId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Pi delete failed: ${response.status} ${response.statusText}`);
      }

      const result: PiUploadResponse = await response.json();
      
      if (!result.success) {
        throw new Error(`Pi delete failed: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Unable to connect to Pi - network error');
      }
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.PI_BASE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const piFileService = new PiFileService();