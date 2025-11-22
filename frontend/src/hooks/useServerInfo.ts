import { useState, useEffect } from 'react';

export interface ServerInfo {
  cpu_percent: number;
  memory_percent: number;
  memory_available_mb: number;
  disk_percent: number;
  disk_free_gb: number;
}

export const useServerInfo = (refreshInterval = 10000) => {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchServerInfo = async () => {
      try {
        const response = await fetch('/api/connection-status/');

        if (!response.ok) {
          throw new Error(`Failed to fetch server info: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.resource_usage) {
          setServerInfo(data.resource_usage);
          setError(null);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        console.error('Error fetching server info:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchServerInfo();

    // Set up polling
    const interval = setInterval(fetchServerInfo, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  return { serverInfo, loading, error };
};
