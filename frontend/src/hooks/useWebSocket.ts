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
    layers_current: number;
    layers_total: number;
    time_remaining: number;
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

interface UseWebSocketOptions {
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export const useWebSocket = (url: string, options: UseWebSocketOptions = {}) => {
  const [data, setData] = useState<LivePrinterData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const { toast } = useToast();
  
  const { 
    reconnectInterval = 5000,
    maxReconnectAttempts = 5
  } = options;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      // Convert http/https URLs to ws/wss
      const wsUrl = url.replace(/^http/, 'ws');
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttemptsRef.current = 0;
        
        if (reconnectAttemptsRef.current > 0) {
          toast({
            title: "Connected",
            description: "Live data connection restored.",
          });
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle different message types
          if (message.type === 'live_status' && message.data) {
            // Extract the data array from the LiveStatusUpdate wrapper
            const statusData = Array.isArray(message.data) ? message.data : [message.data];
            setData(statusData);
          } else if (message.type === 'error') {
            console.error('WebSocket error message:', message.message);
            // Keep existing data on error, don't clear it
          } else {
            console.log('Unknown WebSocket message type:', message);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket data:', error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        
        // Attempt to reconnect if within limits
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
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      toast({
        title: "Connection Error",
        description: "Failed to connect to live data stream.",
        variant: "destructive",
      });
    }
  }, [url, reconnectInterval, maxReconnectAttempts, toast]);

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
    setIsReconnecting(false);
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return {
    data,
    isConnected,
    isReconnecting,
    connect,
    disconnect,
  };
};

export const usePrinterWebSocket = (printerId?: string) => {
  // Determine the WebSocket URL based on current location
  const getWebSocketUrl = () => {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      
      // If we're on the Pi (port 8080), use the same host and port
      // If we're in development, use localhost:8080
      const wsPort = port === '8080' ? '8080' : '8080';
      return `${protocol}//${host}:${wsPort}`;
    }
    // Fallback for SSR
    return 'ws://localhost:8080';
  };

  const baseUrl = getWebSocketUrl();
  
  const url = printerId 
    ? `${baseUrl}/api/v1/ws/live-status/${printerId}`
    : `${baseUrl}/api/v1/ws/live-status-all`;

  return useWebSocket(url, {
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
  });
};