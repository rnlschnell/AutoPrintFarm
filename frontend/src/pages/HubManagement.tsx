import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Loader2, Server, Wifi, WifiOff, AlertTriangle, RefreshCw, Bluetooth, BluetoothOff, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import type { Hub } from '@/types/api';

// =============================================================================
// BLE Configuration (must match ESP32 firmware config.h)
// =============================================================================

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID_SSID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_PASSWORD = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_COMMAND = 'beb54840-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_STATUS = 'beb54841-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_HUB_ID = 'beb54842-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_TENANT_ID = 'beb54843-36e1-4688-b7f5-ea07361b26a8';

// Commands
const CMD_CONNECT = 0x01;
const CMD_DISCONNECT = 0x02;

// Status values
const STATUS_IDLE = 0x00;
const STATUS_CONNECTING = 0x01;
const STATUS_CONNECTED = 0x02;
const STATUS_FAILED = 0x03;
const STATUS_DISCONNECTED = 0x04;
const STATUS_NO_CREDENTIALS = 0x05;

// =============================================================================
// Types
// =============================================================================

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

// Extend Navigator type for Web Bluetooth
declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
    };
  }

  interface RequestDeviceOptions {
    filters?: Array<{ services?: string[] }>;
    optionalServices?: string[];
  }

  interface BluetoothDevice {
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
    removeEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: 'characteristicvaluechanged', listener: (event: CharacteristicValueChangedEvent) => void): void;
    removeEventListener(type: 'characteristicvaluechanged', listener: (event: CharacteristicValueChangedEvent) => void): void;
  }

  interface CharacteristicValueChangedEvent extends Event {
    target: BluetoothRemoteGATTCharacteristic & { value: DataView };
  }
}

// =============================================================================
// Component
// =============================================================================

const HubManagement = () => {
  // Get tenant ID from auth context
  const { tenantId } = useAuth();

  // Hub list state (existing)
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // BLE state
  const [bleSupported, setBleSupported] = useState(true);
  const [bleConnected, setBleConnected] = useState(false);
  const [wifiStatus, setWifiStatus] = useState<number>(STATUS_IDLE);
  const [ssidInput, setSsidInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [hubNameInput, setHubNameInput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([{
    timestamp: new Date().toLocaleTimeString(),
    message: 'Ready. Click "Connect to Hub" to begin.',
    type: 'info'
  }]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Hub registration state
  const [provisionedHubId, setProvisionedHubId] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasRegistered, setHasRegistered] = useState(false);

  // Hub editing state
  const [editingHubId, setEditingHubId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isSavingHub, setIsSavingHub] = useState(false);

  // Hub deletion state
  const [deletingHubId, setDeletingHubId] = useState<string | null>(null);
  const [isDeletingHub, setIsDeletingHub] = useState(false);

  // Hub connection status (real-time from Durable Object)
  const [hubConnectionStatus, setHubConnectionStatus] = useState<Record<string, {
    connected: boolean;
    authenticated: boolean;
    lastChecked: number;
  }>>({});

  // Track GPIO state per hub (for LED test button)
  const [hubGpioState, setHubGpioState] = useState<Record<string, boolean>>({});

  // Track which hubs are being toggled (for loading state)
  const [togglingHubId, setTogglingHubId] = useState<string | null>(null);
  const [togglingGpioHubId, setTogglingGpioHubId] = useState<string | null>(null);

  // Ref to track previous connection status for change detection
  const prevConnectionStatusRef = useRef<Record<string, boolean>>({});

  // BLE references
  const bleDeviceRef = useRef<BluetoothDevice | null>(null);
  const bleServerRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const ssidCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const passwordCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const commandCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const statusCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const hubIdCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const tenantIdCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const logSectionRef = useRef<HTMLDivElement>(null);

  // =============================================================================
  // Logging
  // =============================================================================

  const log = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev, entry]);
    console.log(`[${type}] ${message}`);
  }, []);

  // Auto-scroll log section
  useEffect(() => {
    if (logSectionRef.current) {
      logSectionRef.current.scrollTop = logSectionRef.current.scrollHeight;
    }
  }, [logs]);

  // =============================================================================
  // BLE Status Notification Handler
  // =============================================================================

  const handleStatusNotification = useCallback((event: CharacteristicValueChangedEvent) => {
    const value = event.target.value;
    const status = value.getUint8(0);

    const statusNames: Record<number, string> = {
      [STATUS_IDLE]: 'IDLE',
      [STATUS_CONNECTING]: 'CONNECTING',
      [STATUS_CONNECTED]: 'CONNECTED',
      [STATUS_FAILED]: 'FAILED',
      [STATUS_DISCONNECTED]: 'DISCONNECTED',
      [STATUS_NO_CREDENTIALS]: 'NO_CREDENTIALS'
    };

    const statusName = statusNames[status] || `UNKNOWN(${status})`;
    log(`Status update: ${statusName}`, status === STATUS_CONNECTED ? 'success' : 'info');
    setWifiStatus(status);
  }, [log]);

  // =============================================================================
  // BLE Disconnect Handler
  // =============================================================================

  const onDisconnected = useCallback(() => {
    log('Disconnected from Hub', 'info');
    setBleConnected(false);
    setWifiStatus(STATUS_IDLE);
    bleDeviceRef.current = null;
    bleServerRef.current = null;
    ssidCharRef.current = null;
    passwordCharRef.current = null;
    commandCharRef.current = null;
    statusCharRef.current = null;
    hubIdCharRef.current = null;
    tenantIdCharRef.current = null;
    setProvisionedHubId(null);
    setHasRegistered(false);
  }, [log]);

  // =============================================================================
  // BLE Connection
  // =============================================================================

  const connectToBLE = async () => {
    if (!navigator.bluetooth) {
      log('Web Bluetooth is not supported in this browser!', 'error');
      return;
    }

    try {
      setIsConnecting(true);
      log('Requesting BLE device...', 'info');

      // Request the device with our service UUID
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });

      bleDeviceRef.current = device;
      log(`Found device: ${device.name || 'Unknown'}`, 'success');

      // Set up disconnect handler
      device.addEventListener('gattserverdisconnected', onDisconnected);

      // Connect to GATT server
      log('Connecting to GATT server...', 'info');
      if (!device.gatt) {
        throw new Error('GATT server not available');
      }
      const server = await device.gatt.connect();
      bleServerRef.current = server;
      log('Connected to GATT server', 'success');

      // Get the WiFi provisioning service
      log('Getting WiFi provisioning service...', 'info');
      const service = await server.getPrimaryService(SERVICE_UUID);

      // Get all characteristics
      log('Getting characteristics...', 'info');
      ssidCharRef.current = await service.getCharacteristic(CHAR_UUID_SSID);
      passwordCharRef.current = await service.getCharacteristic(CHAR_UUID_PASSWORD);
      commandCharRef.current = await service.getCharacteristic(CHAR_UUID_COMMAND);
      statusCharRef.current = await service.getCharacteristic(CHAR_UUID_STATUS);

      // Try to get hub registration characteristics (may not exist in older firmware)
      try {
        hubIdCharRef.current = await service.getCharacteristic(CHAR_UUID_HUB_ID);
        tenantIdCharRef.current = await service.getCharacteristic(CHAR_UUID_TENANT_ID);
        log('Hub registration characteristics available', 'info');
      } catch {
        log('Hub registration characteristics not available - firmware update may be needed', 'info');
      }

      // Subscribe to status notifications
      await statusCharRef.current.startNotifications();
      statusCharRef.current.addEventListener('characteristicvaluechanged', handleStatusNotification);

      // Read initial status
      const statusValue = await statusCharRef.current.readValue();
      setWifiStatus(statusValue.getUint8(0));

      // Try to read stored SSID
      try {
        const ssidValue = await ssidCharRef.current.readValue();
        const storedSsid = new TextDecoder().decode(ssidValue);
        // Validate SSID: must be non-empty and contain only printable ASCII characters
        if (storedSsid && /^[\x20-\x7E]+$/.test(storedSsid)) {
          setSsidInput(storedSsid);
          log(`Stored SSID: ${storedSsid}`, 'info');
        }
      } catch {
        // SSID might be empty
      }

      // Try to read stored hub ID (check if already provisioned)
      if (hubIdCharRef.current) {
        try {
          const hubIdValue = await hubIdCharRef.current.readValue();
          const storedHubId = new TextDecoder().decode(hubIdValue);
          log(`Read Hub ID from device: "${storedHubId}" (length: ${storedHubId.length})`, 'info');
          // Validate hub ID: must be a valid UUID (36 characters with dashes)
          if (storedHubId && storedHubId.length === 36 && storedHubId.includes('-')) {
            setProvisionedHubId(storedHubId);
            log(`Hub already provisioned with ID: ${storedHubId}`, 'success');
          } else {
            log('No valid Hub ID stored on device - will generate new one', 'info');
          }
        } catch (err) {
          log(`Failed to read Hub ID: ${err}`, 'error');
        }
      }

      setBleConnected(true);
      log('Ready to configure WiFi!', 'success');

    } catch (err) {
      const error = err as Error;
      log(`Connection failed: ${error.message}`, 'error');
      console.error(error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectBLE = () => {
    if (bleDeviceRef.current?.gatt?.connected) {
      log('Disconnecting...', 'info');
      bleDeviceRef.current.gatt.disconnect();
    }
  };

  // =============================================================================
  // Cloud Hub Registration
  // =============================================================================

  // Use a ref to prevent race conditions with async state updates
  const registrationAttemptedRef = useRef(false);

  const registerHubWithCloud = useCallback(async (hubId: string) => {
    // Use ref for immediate check to prevent race conditions
    if (registrationAttemptedRef.current || isRegistering || hasRegistered) return;
    registrationAttemptedRef.current = true;

    // Check if hub is already in the list (skip unnecessary API call)
    const existingHub = hubs.find(h => h.id === hubId);
    if (existingHub) {
      log(`Hub already registered: ${existingHub.name || hubId}`, 'info');
      setHasRegistered(true);
      return;
    }

    try {
      setIsRegistering(true);
      log('Registering hub with cloud...', 'info');

      const response = await api.post<Hub>('/api/v1/hubs/register', {
        hub_id: hubId,
        name: hubNameInput.trim() || undefined,
      });

      log(`Hub registered successfully: ${response.name || hubId}`, 'success');
      setHasRegistered(true);

      // Refresh hub list
      await fetchHubs();

    } catch (err) {
      const error = err as Error;
      log(`Failed to register hub: ${error.message}`, 'error');
      // Mark as registered to prevent infinite retry loops on error
      setHasRegistered(true);
    } finally {
      setIsRegistering(false);
    }
  }, [isRegistering, hasRegistered, hubNameInput, hubs, log]);

  // Trigger cloud registration when WiFi connects successfully
  useEffect(() => {
    if (wifiStatus === STATUS_CONNECTED && provisionedHubId && !isRegistering && !hasRegistered) {
      registerHubWithCloud(provisionedHubId);
    }
  }, [wifiStatus, provisionedHubId, isRegistering, hasRegistered, registerHubWithCloud]);

  // Reset registration ref when disconnecting
  useEffect(() => {
    if (!bleConnected) {
      registrationAttemptedRef.current = false;
    }
  }, [bleConnected]);

  // =============================================================================
  // WiFi Configuration
  // =============================================================================

  const saveAndConnect = async () => {
    const ssid = ssidInput.trim();
    const password = passwordInput;

    if (!ssid) {
      log('Please enter a WiFi network name', 'error');
      return;
    }

    if (!ssidCharRef.current || !passwordCharRef.current || !commandCharRef.current) {
      log('BLE characteristics not available', 'error');
      return;
    }

    if (!tenantId) {
      log('No tenant ID available - please log in', 'error');
      return;
    }

    try {
      setIsSaving(true);

      // Generate new hub ID if not already set
      let hubId = provisionedHubId;
      if (!hubId) {
        hubId = crypto.randomUUID();
        setProvisionedHubId(hubId);
        log(`Generated new Hub ID: ${hubId}`, 'info');
      } else {
        log(`Using existing Hub ID: ${hubId}`, 'info');
      }

      // Write hub ID to device (if characteristic available)
      if (hubIdCharRef.current) {
        log(`Setting Hub ID: ${hubId}`, 'info');
        await hubIdCharRef.current.writeValue(new TextEncoder().encode(hubId));
      }

      // Write tenant ID to device (if characteristic available)
      if (tenantIdCharRef.current) {
        log(`Setting Tenant ID: ${tenantId}`, 'info');
        await tenantIdCharRef.current.writeValue(new TextEncoder().encode(tenantId));
      }

      // Write SSID
      log(`Setting SSID: ${ssid}`, 'info');
      const ssidEncoder = new TextEncoder();
      await ssidCharRef.current.writeValue(ssidEncoder.encode(ssid));

      // Write password
      log('Setting password...', 'info');
      const passEncoder = new TextEncoder();
      await passwordCharRef.current.writeValue(passEncoder.encode(password));

      // Send connect command
      log('Sending connect command...', 'info');
      await commandCharRef.current.writeValue(new Uint8Array([CMD_CONNECT]));

      log('WiFi connection initiated', 'success');

    } catch (err) {
      const error = err as Error;
      log(`Error: ${error.message}`, 'error');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const disconnectWifi = async () => {
    if (!commandCharRef.current) {
      log('BLE characteristics not available', 'error');
      return;
    }

    try {
      log('Sending disconnect command...', 'info');
      await commandCharRef.current.writeValue(new Uint8Array([CMD_DISCONNECT]));
      log('WiFi disconnect requested', 'info');
    } catch (err) {
      const error = err as Error;
      log(`Error: ${error.message}`, 'error');
      console.error(error);
    }
  };

  // =============================================================================
  // Hub List Functions (existing)
  // =============================================================================

  const fetchHubs = async () => {
    try {
      setLoading(true);
      setError(null);
      // API returns array directly in data field (unwrapped by api client)
      const response = await api.get<Hub[]>('/api/v1/hubs');
      setHubs(response || []);
    } catch (err) {
      console.error('Failed to fetch hubs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load hubs');
    } finally {
      setLoading(false);
    }
  };

  // Fetch real-time connection status for a hub from the Durable Object
  const fetchHubConnectionStatus = useCallback(async (hubId: string) => {
    try {
      const response = await api.get<{
        hub_id: string;
        connected: boolean;
        authenticated: boolean;
        connected_at?: number;
        last_message_at?: number;
        firmware_version?: string;
      }>(`/api/v1/hubs/${hubId}/connection`);

      const isNowConnected = response.connected && response.authenticated;
      const wasConnected = prevConnectionStatusRef.current[hubId];
      const isFirstCheck = wasConnected === undefined;

      // Get hub name for display (fallback to last 8 chars of ID)
      const hub = hubs.find(h => h.id === hubId);
      const hubDisplayName = hub?.name || hubId.slice(-8);

      // Log status changes to the console
      if (isFirstCheck) {
        // First check - log initial state
        if (isNowConnected) {
          log(`${hubDisplayName} is connected to cloud`, 'success');
        } else {
          log(`${hubDisplayName} is not connected`, 'info');
        }
      } else if (wasConnected !== isNowConnected) {
        // Status changed
        if (isNowConnected) {
          log(`${hubDisplayName} connected to cloud`, 'success');
        } else {
          log(`${hubDisplayName} disconnected from cloud`, 'error');
        }
      }
      // Log periodic status check to the UI log panel
      // This confirms polling is working and shows real-time WebSocket status
      if (!isFirstCheck) {
        if (isNowConnected) {
          log(`${hubDisplayName} online (ws: ${response.connected ? 'open' : 'closed'}, auth: ${response.authenticated ? 'yes' : 'no'})`, 'success');
        } else {
          log(`${hubDisplayName} offline (ws: ${response.connected ? 'open' : 'closed'}, auth: ${response.authenticated ? 'yes' : 'no'})`, 'info');
        }
      }

      // Update ref for next comparison
      prevConnectionStatusRef.current[hubId] = isNowConnected;

      setHubConnectionStatus(prev => ({
        ...prev,
        [hubId]: {
          connected: response.connected,
          authenticated: response.authenticated,
          lastChecked: Date.now(),
        }
      }));
    } catch (err) {
      // If the connection endpoint fails, mark as unknown
      console.error(`Failed to fetch connection status for hub ${hubId}:`, err);
    }
  }, [log, hubs]);

  // Fetch connection status for all hubs
  const fetchAllHubConnectionStatus = useCallback(async () => {
    if (hubs.length === 0) return;

    await Promise.all(hubs.map(hub => fetchHubConnectionStatus(hub.id)));
  }, [hubs, fetchHubConnectionStatus]);

  const updateHubName = async (hubId: string, name: string) => {
    try {
      setIsSavingHub(true);
      await api.put(`/api/v1/hubs/${hubId}`, { name });
      await fetchHubs();
      setEditingHubId(null);
      setEditingName('');
    } catch (err) {
      console.error('Failed to update hub:', err);
      setError(err instanceof Error ? err.message : 'Failed to update hub');
    } finally {
      setIsSavingHub(false);
    }
  };

  const deleteHub = async (hubId: string) => {
    try {
      setIsDeletingHub(true);
      await api.delete(`/api/v1/hubs/${hubId}`);
      await fetchHubs();
      setDeletingHubId(null);
    } catch (err) {
      console.error('Failed to delete hub:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete hub');
    } finally {
      setIsDeletingHub(false);
    }
  };

  const startEditing = (hub: Hub) => {
    setEditingHubId(hub.id);
    setEditingName(hub.name || '');
  };

  const cancelEditing = () => {
    setEditingHubId(null);
    setEditingName('');
  };

  const formatLastSeen = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  };

  // =============================================================================
  // Hub Cloud Control Functions
  // =============================================================================

  const disconnectHubCloud = async (hubId: string) => {
    try {
      setTogglingHubId(hubId);
      log(`Sending disconnect command to hub ${hubId.slice(-8)}...`, 'info');

      await api.post(`/api/v1/hubs/${hubId}/disconnect`);

      log(`Hub ${hubId.slice(-8)} disconnect command sent. Restart hub to reconnect.`, 'success');

      // Refresh connection status after a short delay
      setTimeout(() => {
        fetchHubConnectionStatus(hubId);
      }, 1000);
    } catch (err) {
      const error = err as Error;
      log(`Failed to disconnect hub: ${error.message}`, 'error');
    } finally {
      setTogglingHubId(null);
    }
  };

  const toggleGpio = async (hubId: string, pin: number = 2) => {
    try {
      setTogglingGpioHubId(hubId);
      const currentState = hubGpioState[hubId] ?? false;
      const newState = !currentState;

      log(`Setting GPIO ${pin} to ${newState ? 'HIGH' : 'LOW'} on hub ${hubId.slice(-8)}...`, 'info');

      await api.post(`/api/v1/hubs/${hubId}/gpio`, { pin, state: newState });

      setHubGpioState(prev => ({ ...prev, [hubId]: newState }));
      log(`GPIO ${pin} set to ${newState ? 'HIGH' : 'LOW'} on hub ${hubId.slice(-8)}`, 'success');
    } catch (err) {
      const error = err as Error;
      log(`Failed to set GPIO: ${error.message}`, 'error');
    } finally {
      setTogglingGpioHubId(null);
    }
  };

  // =============================================================================
  // Effects
  // =============================================================================

  useEffect(() => {
    // Check Web Bluetooth support
    if (!navigator.bluetooth) {
      setBleSupported(false);
    }

    // Fetch hubs
    fetchHubs();

    // Cleanup on unmount
    return () => {
      if (bleDeviceRef.current?.gatt?.connected) {
        bleDeviceRef.current.gatt.disconnect();
      }
    };
  }, []);

  // Fetch connection status when hubs change (initial load only)
  useEffect(() => {
    if (hubs.length > 0) {
      fetchAllHubConnectionStatus();
    }
  // Only run when hubs array changes (initial load or manual refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubs.length]);

  // Store hub IDs in a ref to avoid restarting the interval on every hub list change
  const hubIdsRef = useRef<string[]>([]);
  useEffect(() => {
    hubIdsRef.current = hubs.map(h => h.id);
  }, [hubs]);

  // Poll for connection status only (not the entire hub list) every 15 seconds
  useEffect(() => {
    if (hubs.length === 0) return;

    const pollStatus = async () => {
      const hubIds = hubIdsRef.current;
      if (hubIds.length === 0) return;
      await Promise.all(hubIds.map(id => fetchHubConnectionStatus(id)));
    };

    const interval = setInterval(pollStatus, 15000);

    return () => clearInterval(interval);
  }, [hubs.length, fetchHubConnectionStatus]);

  // =============================================================================
  // WiFi Status Display
  // =============================================================================

  const getWifiStatusDisplay = () => {
    const statusMap: Record<number, { text: string; variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
      [STATUS_IDLE]: { text: 'Idle', variant: 'secondary' },
      [STATUS_CONNECTING]: { text: 'Connecting...', variant: 'default', className: 'bg-yellow-500 animate-pulse' },
      [STATUS_CONNECTED]: { text: 'Connected', variant: 'default', className: 'bg-green-600' },
      [STATUS_FAILED]: { text: 'Connection Failed', variant: 'destructive' },
      [STATUS_DISCONNECTED]: { text: 'Disconnected', variant: 'secondary' },
      [STATUS_NO_CREDENTIALS]: { text: 'No Credentials', variant: 'secondary' }
    };

    return statusMap[wifiStatus] || { text: `Unknown (${wifiStatus})`, variant: 'secondary' as const };
  };

  const wifiStatusDisplay = getWifiStatusDisplay();

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hub Management</h1>
          <p className="text-muted-foreground">Configure and manage your AutoPrintFarm Hubs</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHubs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Browser Support Alert */}
      {!bleSupported && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Web Bluetooth is not supported in this browser. Please use Chrome or Edge on desktop/Android to provision hubs.
          </AlertDescription>
        </Alert>
      )}

      {/* BLE Provisioning Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5" />
            Hub WiFi Provisioning
          </CardTitle>
          <CardDescription>
            Connect to an AutoPrintFarm Hub via Bluetooth to configure its WiFi settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Display */}
          <div className="flex flex-col gap-2 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Bluetooth:</span>
              {bleConnected ? (
                <Badge className="bg-green-600 text-white gap-1">
                  <Bluetooth className="h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <BluetoothOff className="h-3 w-3" /> Not Connected
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">WiFi:</span>
              <Badge
                variant={wifiStatusDisplay.variant}
                className={`gap-1 ${wifiStatusDisplay.className || ''}`}
              >
                {wifiStatus === STATUS_CONNECTED ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                {wifiStatusDisplay.text}
              </Badge>
            </div>
          </div>

          {/* Connect Button (shown when not connected to BLE) */}
          {!bleConnected && (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={connectToBLE}
                disabled={!bleSupported || isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Bluetooth className="h-4 w-4 mr-2" />
                    Connect to Hub
                  </>
                )}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Make sure your AutoPrintFarm Hub is powered on
              </p>
            </div>
          )}

          {/* WiFi Configuration (shown after BLE connection) */}
          {bleConnected && (
            <div className="space-y-4">
              <div className="space-y-4 p-4 border rounded-lg">
                {/* Hub Name (optional) */}
                <div className="space-y-2">
                  <Label htmlFor="hubName">Hub Name (optional)</Label>
                  <Input
                    id="hubName"
                    type="text"
                    placeholder="e.g., Workshop Hub 1"
                    maxLength={100}
                    value={hubNameInput}
                    onChange={(e) => setHubNameInput(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A friendly name for this hub. If not provided, a default name will be generated.
                  </p>
                </div>
                {/* Hub ID display (if already provisioned) */}
                {provisionedHubId && (
                  <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                    Hub ID: <code className="font-mono">{provisionedHubId}</code>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="ssid">WiFi Network Name (SSID)</Label>
                  <Input
                    id="ssid"
                    type="text"
                    placeholder="Enter your WiFi name"
                    maxLength={32}
                    value={ssidInput}
                    onChange={(e) => setSsidInput(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">WiFi Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your WiFi password"
                    maxLength={64}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={saveAndConnect}
                  disabled={isSaving || isRegistering}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : isRegistering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <Wifi className="h-4 w-4 mr-2" />
                      Connect to WiFi
                    </>
                  )}
                </Button>
              </div>

              <Button
                variant="destructive"
                className="w-full"
                onClick={disconnectWifi}
              >
                <WifiOff className="h-4 w-4 mr-2" />
                Disconnect from WiFi
              </Button>

              <Button
                variant="secondary"
                className="w-full"
                onClick={disconnectBLE}
              >
                <BluetoothOff className="h-4 w-4 mr-2" />
                Disconnect from Hub
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Console */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Log Console</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logSectionRef}
            className="bg-muted/50 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-1"
          >
            {logs.map((entry, index) => (
              <div
                key={index}
                className={`${
                  entry.type === 'info' ? 'text-blue-500' :
                  entry.type === 'success' ? 'text-green-500' :
                  'text-red-500'
                }`}
              >
                [{entry.timestamp}] {entry.message}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Divider */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold mb-4">Registered Hubs</h2>
      </div>

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading hubs...</span>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && hubs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Hubs Found</h3>
            <p className="text-muted-foreground max-w-sm">
              No hubs have connected to your account yet. Once an ESP32 hub connects to the cloud, it will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Hub list */}
      {!loading && hubs.length > 0 && (
        <div className="space-y-4">
          {hubs.map((hub) => (
            <Card key={hub.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  {editingHubId === hub.id ? (
                    <div className="flex items-center gap-2 flex-1 mr-4">
                      <Server className="h-5 w-5 flex-shrink-0" />
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-8"
                        placeholder="Hub name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editingName.trim()) {
                            updateHubName(hub.id, editingName.trim());
                          } else if (e.key === 'Escape') {
                            cancelEditing();
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => editingName.trim() && updateHubName(hub.id, editingName.trim())}
                        disabled={isSavingHub || !editingName.trim()}
                      >
                        {isSavingHub ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={cancelEditing}
                        disabled={isSavingHub}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : deletingHubId === hub.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm text-destructive">Delete this hub?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7"
                        onClick={() => deleteHub(hub.id)}
                        disabled={isDeletingHub}
                      >
                        {isDeletingHub ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setDeletingHubId(null)}
                        disabled={isDeletingHub}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        {hub.name || 'Unnamed Hub'}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => startEditing(hub)}
                          title="Rename hub"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeletingHubId(hub.id)}
                          title="Delete hub"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {(() => {
                          const liveStatus = hubConnectionStatus[hub.id];
                          const isLiveConnected = liveStatus?.connected && liveStatus?.authenticated;

                          // Use live status if available and recent (within 30 seconds), otherwise use database status
                          // Note: hub.is_online is a SQLite boolean (0/1), not a JS boolean
                          const isOnline = liveStatus && (Date.now() - liveStatus.lastChecked < 30000)
                            ? isLiveConnected
                            : Boolean(hub.is_online);

                          if (isOnline) {
                            return (
                              <Badge className="bg-green-600 text-white gap-1">
                                <Wifi className="h-3 w-3" /> Connected
                              </Badge>
                            );
                          } else {
                            return (
                              <Badge variant="secondary" className="gap-1">
                                <WifiOff className="h-3 w-3" /> Offline
                              </Badge>
                            );
                          }
                        })()}
                      </div>
                    </>
                  )}
                </div>
                <CardDescription className="flex items-center gap-2">
                  {(() => {
                    const liveStatus = hubConnectionStatus[hub.id];
                    const isLiveConnected = liveStatus?.connected && liveStatus?.authenticated;
                    const isOnline = liveStatus && (Date.now() - liveStatus.lastChecked < 30000)
                      ? isLiveConnected
                      : Boolean(hub.is_online);

                    if (isOnline) {
                      return (
                        <>
                          <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-green-600">Active now</span>
                        </>
                      );
                    }
                    return (
                      <>
                        <span>Last seen: {formatLastSeen(hub.last_seen_at)}</span>
                      </>
                    );
                  })()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Firmware:</span>
                    <span className="ml-2">{hub.firmware_version || 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Hardware:</span>
                    <span className="ml-2">{hub.hardware_version || 'Unknown'}</span>
                  </div>
                  {hub.ip_address && (
                    <div>
                      <span className="text-muted-foreground">IP Address:</span>
                      <span className="ml-2">{hub.ip_address}</span>
                    </div>
                  )}
                  {hub.mac_address && (
                    <div>
                      <span className="text-muted-foreground">MAC Address:</span>
                      <span className="ml-2">{hub.mac_address}</span>
                    </div>
                  )}
                </div>

                {/* Hub Control Section */}
                <div className="mt-4 pt-4 border-t space-y-3">
                  {/* Cloud Connection Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor={`cloud-toggle-${hub.id}`} className="text-sm font-normal">
                        Cloud Connection
                      </Label>
                    </div>
                    <Switch
                      id={`cloud-toggle-${hub.id}`}
                      checked={hubConnectionStatus[hub.id]?.connected ?? false}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          disconnectHubCloud(hub.id);
                        }
                        // Cannot turn back on from UI - requires hub restart
                      }}
                      disabled={togglingHubId === hub.id || !hubConnectionStatus[hub.id]?.connected}
                    />
                  </div>
                  {/* Show hint when offline */}
                  {!hubConnectionStatus[hub.id]?.connected && (
                    <p className="text-xs text-muted-foreground pl-6">
                      Restart hub to reconnect
                    </p>
                  )}

                  {/* GPIO Test Button */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 flex items-center justify-center text-muted-foreground text-xs font-mono">IO</span>
                      <span className="text-sm">LED Test (GPIO2)</span>
                    </div>
                    <Button
                      size="sm"
                      variant={hubGpioState[hub.id] ? "default" : "outline"}
                      onClick={() => toggleGpio(hub.id)}
                      disabled={togglingGpioHubId === hub.id || !hubConnectionStatus[hub.id]?.connected}
                      className="w-16"
                    >
                      {togglingGpioHubId === hub.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        hubGpioState[hub.id] ? 'ON' : 'OFF'
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default HubManagement;
