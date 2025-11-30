import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export interface LivePrinterData {
  printer_id: string;
  status: string;
  temperatures: {
    nozzle: {
      current: number;
      target: number;
      is_heating: boolean;
    };
    bed: {
      current: number;
      target: number;
      is_heating: boolean;
    };
    chamber?: {
      current: number;
      target: number;
      is_heating: boolean;
    };
  };
  progress: {
    percentage: number;
    current_layer: number;
    total_layers: number;
    remaining_time: number;
  };
  current_job?: {
    filename: string;
    print_id: string;
    subtask_name: string;
    project_id: string;
  };
  light_on: boolean;
  is_connected: boolean;
  error?: string;
}

/**
 * Dashboard WebSocket hook for cloud-based real-time updates
 * Connects to the cloud DashboardBroadcast Durable Object for live printer status
 *
 * Messages received: printer_status, job_update, hub_status, inventory_alert, new_order
 */
export const useDashboardWebSocket = (tenantId: string, authToken: string) => {
  const [data, setData] = useState<LivePrinterData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const { toast } = useToast();

  const maxReconnectAttempts = 10;
  const reconnectInterval = 3000;

  // Build the WebSocket URL for cloud dashboard
  const getWebSocketUrl = useCallback(() => {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;

      // In development, the frontend runs on a different port than the backend
      // Use the API base URL logic to determine the correct backend port
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
      if (apiBaseUrl) {
        // Extract host and port from API base URL (e.g., "http://localhost:8787")
        const apiUrl = new URL(apiBaseUrl);
        const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${apiUrl.host}/ws/dashboard?tenant=${tenantId}`;
      }

      // Fallback: assume same host, port 8787 for local dev
      if (host === 'localhost' || host === '127.0.0.1') {
        return `ws://${host}:8787/ws/dashboard?tenant=${tenantId}`;
      }

      // Production: use same host/port as the page
      const port = window.location.port;
      let baseUrl: string;
      if (port) {
        baseUrl = `${protocol}//${host}:${port}`;
      } else {
        baseUrl = `${protocol}//${host}`;
      }

      return `${baseUrl}/ws/dashboard?tenant=${tenantId}`;
    }
    return `ws://localhost:8787/ws/dashboard?tenant=${tenantId}`;
  }, [tenantId]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[DashboardWS] Already connected, skipping');
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      console.log('[DashboardWS] Connecting to:', wsUrl);
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('[DashboardWS] Connected to cloud dashboard');
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttemptsRef.current = 0;

        // Send authentication message
        if (wsRef.current && authToken) {
          wsRef.current.send(JSON.stringify({
            type: 'auth',
            token: authToken,
          }));
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'auth_success':
              console.log('[DashboardWS] Authenticated successfully');
              setIsAuthenticated(true);
              // Subscribe to all printers
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({
                  type: 'subscribe',
                  printers: [], // Empty array = subscribe to all
                }));
              }
              break;

            case 'auth_error':
              console.error('[DashboardWS] Authentication failed:', message.error);
              setIsAuthenticated(false);
              toast({
                title: "Authentication Failed",
                description: message.error || "Failed to authenticate WebSocket connection",
                variant: "destructive",
              });
              break;

            case 'printer_status':
              // Log full printer status for debugging
              console.log('[DashboardWS] Printer status received:', {
                printer_id: message.printer_id,
                status: message.status,
                is_connected: message.is_connected,
                temperatures: message.temperatures,
                progress: message.progress_percentage,
              });
              // Update printer data with new status
              setData(prevData => {
                const newData = [...prevData];
                const printerId = message.printer_id;
                const index = newData.findIndex(p => p.printer_id === printerId);

                // Build LivePrinterData from cloud message
                const updatedPrinter: LivePrinterData = {
                  printer_id: printerId,
                  status: message.status,
                  temperatures: {
                    nozzle: {
                      current: message.temperatures?.nozzle ?? 0,
                      target: message.temperatures?.nozzle_target ?? 0,
                      is_heating: (message.temperatures?.nozzle ?? 0) < (message.temperatures?.nozzle_target ?? 0) - 2,
                    },
                    bed: {
                      current: message.temperatures?.bed ?? 0,
                      target: message.temperatures?.bed_target ?? 0,
                      is_heating: (message.temperatures?.bed ?? 0) < (message.temperatures?.bed_target ?? 0) - 2,
                    },
                    chamber: message.temperatures?.chamber ? {
                      current: message.temperatures.chamber,
                      target: 0,
                      is_heating: false,
                    } : undefined,
                  },
                  progress: {
                    percentage: message.progress_percentage ?? 0,
                    current_layer: message.current_layer ?? 0,
                    total_layers: message.total_layers ?? 0,
                    remaining_time: message.remaining_time_seconds ?? 0,
                  },
                  is_connected: message.is_connected ?? true,
                  light_on: false, // Will be updated when we implement light status
                };

                if (index >= 0) {
                  newData[index] = updatedPrinter;
                } else {
                  newData.push(updatedPrinter);
                }

                return newData;
              });
              break;

            case 'hub_status':
              console.log('[DashboardWS] Hub status update:', message);
              // Could dispatch to a hub status context if needed
              break;

            case 'job_update':
              console.log('[DashboardWS] Job update:', message);
              // Could dispatch to a jobs context if needed
              break;

            case 'error':
              console.error('[DashboardWS] Error:', message.message);
              break;

            default:
              console.log('[DashboardWS] Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('[DashboardWS] Failed to parse message:', error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('[DashboardWS] Disconnected');
        setIsConnected(false);
        setIsAuthenticated(false);

        // Attempt to reconnect
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          setIsReconnecting(true);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            connect();
          }, reconnectInterval);
        } else {
          toast({
            title: "Connection Lost",
            description: "Unable to reconnect to live data stream.",
            variant: "destructive",
          });
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[DashboardWS] WebSocket error:', error);
      };

    } catch (error) {
      console.error('[DashboardWS] Failed to create connection:', error);
    }
  }, [getWebSocketUrl, authToken, toast]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsAuthenticated(false);
    setIsReconnecting(false);
  }, []);

  // Connect when tenantId and authToken are available
  useEffect(() => {
    console.log('[DashboardWS] useEffect triggered - tenantId:', tenantId, 'authToken:', authToken ? 'present' : 'missing');
    if (tenantId && authToken) {
      console.log('[DashboardWS] Attempting to connect...');
      connect();
    } else {
      console.log('[DashboardWS] Not connecting - missing tenantId or authToken');
    }
    return disconnect;
  }, [tenantId, authToken, connect, disconnect]);

  return {
    data,
    isConnected,
    isAuthenticated,
    isReconnecting,
    connect,
    disconnect,
  };
};
