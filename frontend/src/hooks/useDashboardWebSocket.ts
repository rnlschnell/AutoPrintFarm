/**
 * Dashboard WebSocket Hook
 *
 * Manages real-time connection to the DashboardBroadcast Durable Object
 * for receiving live printer status updates, hub status, and other events.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { getApiBaseUrl } from '@/lib/api-client';

// =============================================================================
// TYPES
// =============================================================================

export interface DashboardPrinterStatus {
  printer_id: string;
  status: string;
  progress_percentage?: number;
  remaining_time_seconds?: number;
  current_layer?: number;
  total_layers?: number;
  temperatures?: {
    nozzle?: number;
    bed?: number;
    chamber?: number;
  };
  error_message?: string;
}

export interface DashboardHubStatus {
  hub_id: string;
  is_online: boolean;
}

export interface DashboardJobUpdate {
  job_id: string;
  status?: string;
  stage?: string;
  progress_percentage?: number;
  error?: string;
  printer_id?: string;
}

export interface DashboardInventoryAlert {
  sku_id: string;
  sku: string;
  current_stock: number;
  threshold: number;
}

export interface DashboardNewOrder {
  order_id: string;
  order_number: string;
  platform: string;
  total_items: number;
}

interface DashboardMessage {
  type: string;
  [key: string]: unknown;
}

interface UseDashboardWebSocketOptions {
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  autoSubscribeAll?: boolean;
}

export interface UseDashboardWebSocketReturn {
  // Connection state
  isConnected: boolean;
  isReconnecting: boolean;
  isAuthenticated: boolean;

  // Data maps
  printerStatuses: Map<string, DashboardPrinterStatus>;
  hubStatuses: Map<string, DashboardHubStatus>;

  // Recent events (for notifications)
  lastJobUpdate: DashboardJobUpdate | null;
  lastInventoryAlert: DashboardInventoryAlert | null;
  lastNewOrder: DashboardNewOrder | null;

  // Last update time
  lastUpdate: Date | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  subscribe: (printerIds: string[]) => void;
  unsubscribe: () => void;
}

// =============================================================================
// HOOK
// =============================================================================

export const useDashboardWebSocket = (
  options: UseDashboardWebSocketOptions = {}
): UseDashboardWebSocketReturn => {
  const { tenantId, session, isInitialized } = useAuth();
  const { toast } = useToast();

  const {
    reconnectInterval = 5000,
    maxReconnectAttempts = 10,
    autoSubscribeAll = true,
  } = options;

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Data maps (using useState with Map for reactivity)
  const [printerStatuses, setPrinterStatuses] = useState<Map<string, DashboardPrinterStatus>>(new Map());
  const [hubStatuses, setHubStatuses] = useState<Map<string, DashboardHubStatus>>(new Map());

  // Recent events
  const [lastJobUpdate, setLastJobUpdate] = useState<DashboardJobUpdate | null>(null);
  const [lastInventoryAlert, setLastInventoryAlert] = useState<DashboardInventoryAlert | null>(null);
  const [lastNewOrder, setLastNewOrder] = useState<DashboardNewOrder | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Refs for WebSocket management
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const wasConnectedRef = useRef(false);

  /**
   * Build WebSocket URL for dashboard connection
   */
  const getWebSocketUrl = useCallback(() => {
    if (!tenantId) return null;

    const apiBaseUrl = getApiBaseUrl();
    // Convert http(s) to ws(s)
    const wsBaseUrl = apiBaseUrl.replace(/^http/, 'ws');
    return `${wsBaseUrl}/ws/dashboard?tenant=${tenantId}`;
  }, [tenantId]);

  /**
   * Send a message to the WebSocket server
   */
  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: DashboardMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'auth_success':
          setIsAuthenticated(true);
          // Auto-subscribe to all printers if enabled
          if (autoSubscribeAll) {
            sendMessage({ type: 'subscribe', printers: [] });
          }
          break;

        case 'auth_error':
          console.error('[DashboardWS] Authentication error:', message.error);
          setIsAuthenticated(false);
          break;

        case 'printer_status': {
          const status = message as unknown as DashboardPrinterStatus;
          setPrinterStatuses(prev => {
            const next = new Map(prev);
            next.set(status.printer_id, status);
            return next;
          });
          setLastUpdate(new Date());
          break;
        }

        case 'hub_status': {
          const status = message as unknown as DashboardHubStatus;
          setHubStatuses(prev => {
            const next = new Map(prev);
            next.set(status.hub_id, status);
            return next;
          });
          setLastUpdate(new Date());
          break;
        }

        case 'job_update': {
          const update = message as unknown as DashboardJobUpdate;
          setLastJobUpdate(update);
          setLastUpdate(new Date());
          break;
        }

        case 'inventory_alert': {
          const alert = message as unknown as DashboardInventoryAlert;
          setLastInventoryAlert(alert);
          setLastUpdate(new Date());
          break;
        }

        case 'new_order': {
          const order = message as unknown as DashboardNewOrder;
          setLastNewOrder(order);
          setLastUpdate(new Date());
          break;
        }

        default:
          console.log('[DashboardWS] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[DashboardWS] Failed to parse message:', error);
    }
  }, [autoSubscribeAll, sendMessage]);

  /**
   * Connect to the WebSocket server
   */
  const connect = useCallback(async () => {
    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Don't connect without tenant
    const wsUrl = getWebSocketUrl();
    if (!wsUrl) {
      console.log('[DashboardWS] Cannot connect - no tenant ID');
      return;
    }

    // Get fresh session token
    const sessionResult = await authClient.getSession();
    const token = sessionResult.data?.session?.id;

    if (!token) {
      console.log('[DashboardWS] Cannot connect - no session token');
      return;
    }

    try {
      console.log('[DashboardWS] Connecting to:', wsUrl);
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('[DashboardWS] Connected');
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttemptsRef.current = 0;

        // Send auth message
        sendMessage({
          type: 'auth',
          token: token,
        });

        // Show toast if reconnecting
        if (wasConnectedRef.current) {
          toast({
            title: 'Reconnected',
            description: 'Live data connection restored.',
          });
        }
        wasConnectedRef.current = true;
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onclose = (event) => {
        console.log('[DashboardWS] Disconnected:', event.code, event.reason);
        setIsConnected(false);
        setIsAuthenticated(false);

        // Attempt to reconnect if within limits
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          setIsReconnecting(true);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            console.log(`[DashboardWS] Reconnect attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
            connect();
          }, reconnectInterval);
        } else if (wasConnectedRef.current) {
          toast({
            title: 'Connection Lost',
            description: 'Unable to reconnect to live data stream.',
            variant: 'destructive',
          });
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[DashboardWS] Error:', error);
      };
    } catch (error) {
      console.error('[DashboardWS] Failed to create connection:', error);
    }
  }, [getWebSocketUrl, handleMessage, maxReconnectAttempts, reconnectInterval, sendMessage, toast]);

  /**
   * Disconnect from the WebSocket server
   */
  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsReconnecting(false);
    setIsAuthenticated(false);
  }, []);

  /**
   * Subscribe to specific printers (or all if empty array)
   */
  const subscribe = useCallback((printerIds: string[]) => {
    sendMessage({
      type: 'subscribe',
      printers: printerIds,
    });
  }, [sendMessage]);

  /**
   * Unsubscribe from all printers
   */
  const unsubscribe = useCallback(() => {
    sendMessage({
      type: 'subscribe',
      printers: [],
      unsubscribe: true,
    });
  }, [sendMessage]);

  // Connect when auth is initialized and we have a tenant
  useEffect(() => {
    if (isInitialized && tenantId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [isInitialized, tenantId, connect, disconnect]);

  // Memoize return value to prevent unnecessary re-renders
  return useMemo(() => ({
    isConnected,
    isReconnecting,
    isAuthenticated,
    printerStatuses,
    hubStatuses,
    lastJobUpdate,
    lastInventoryAlert,
    lastNewOrder,
    lastUpdate,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
  }), [
    isConnected,
    isReconnecting,
    isAuthenticated,
    printerStatuses,
    hubStatuses,
    lastJobUpdate,
    lastInventoryAlert,
    lastNewOrder,
    lastUpdate,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
  ]);
};

export default useDashboardWebSocket;
