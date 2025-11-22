const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

interface DatabaseInfoResponse {
  database_path: string;
  database_size_bytes: number;
  database_size_mb: number;
  last_modified: string;
  tables: Record<string, number>;
  total_records: number;
  backup_directory: string;
  database_type: string;
  version: string;
}

interface RestoreResponse {
  success: boolean;
  message: string;
  details: {
    backup_format: string;
    restore_type: string;
    restored_tables: string[];
    table_counts: Record<string, number>;
    database_backup_created: string | null;
    files_backup_created: string | null;
    restored_files_count: number;
    restored_from: string;
    restoration_timestamp: string;
    original_backup_metadata?: any;
  };
}

class BackupService {
  /**
   * Get current database information and statistics
   */
  async getDatabaseInfo(): Promise<DatabaseInfoResponse> {
    const response = await fetch(`${API_BASE_URL}/api/database/backup/info`, {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Failed to fetch database info");
    }

    return response.json();
  }

  /**
   * Download complete database backup as tar archive
   *
   * @param tenantName - Optional tenant/company name to include in filename
   */
  async downloadBackup(tenantName?: string): Promise<void> {
    // Build URL with parameters
    const params = new URLSearchParams({
      compress: "true",
      include_metadata: "true",
      include_files: "true",
      validate_files: "true"
    });
    if (tenantName) {
      params.append("tenant_name", tenantName);
    }
    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/database/backup/download?${queryString}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Failed to download backup");
    }

    // Get filename from Content-Disposition header if available
    const contentDisposition = response.headers.get("Content-Disposition");
    let filename = `printfarm_backup_${new Date().toISOString().split("T")[0].replace(/-/g, "")}.tar`;

    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename=["']?([^"';]+)["']?/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }

    // Create blob from response
    const blob = await response.blob();

    // Create download link
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;

    // Trigger download
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  /**
   * Restore database from uploaded backup file
   */
  async restoreBackup(file: File, createBackupBeforeRestore: boolean = true): Promise<RestoreResponse> {
    const formData = new FormData();
    formData.append("backup_file", file);
    formData.append("create_backup_before_restore", createBackupBeforeRestore.toString());

    const response = await fetch(`${API_BASE_URL}/api/database/backup/restore`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Failed to restore backup");
    }

    return response.json();
  }
}

export const backupService = new BackupService();