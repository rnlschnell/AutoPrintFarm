const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

interface LogsStatusResponse {
  success: boolean;
  stats: {
    total_size: number;
    total_size_mb: number;
    file_count: number;
    oldest_entry: string | null;
    newest_entry: string | null;
    files: Array<{
      name: string;
      size: number;
      modified: string;
    }>;
  };
}

class LogsService {
  /**
   * Get current logs status and statistics
   */
  async getLogsStatus(): Promise<LogsStatusResponse> {
    const response = await fetch(`${API_BASE_URL}/api/logs/status`, {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Failed to fetch logs status");
    }

    return response.json();
  }

  /**
   * Download logs as a ZIP archive
   *
   * @param tenantName - Optional tenant/company name to include in filename
   */
  async downloadLogs(tenantName?: string): Promise<void> {
    // Build URL with optional tenant_name parameter
    const params = new URLSearchParams();
    if (tenantName) {
      params.append("tenant_name", tenantName);
    }
    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/logs/download${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Failed to download logs");
    }

    // Get filename from Content-Disposition header if available
    const contentDisposition = response.headers.get("Content-Disposition");
    let filename = `printfarm-logs-${new Date().toISOString().split("T")[0]}.zip`;

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
}

export const logsService = new LogsService();