import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bluetooth, BluetoothConnected, BluetoothOff, Wifi, WifiOff, AlertTriangle, Loader2 } from "lucide-react";

// BLE UUIDs - must match ESP32 firmware
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CREDENTIALS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const STATUS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';

// Status codes from ESP32
const STATUS_IDLE = 0x00;
const STATUS_CONNECTING = 0x02;
const STATUS_CONNECTED = 0x03;
const STATUS_FAILED = 0x04;

type BleStatus = 'disconnected' | 'connecting' | 'connected';
type WifiStatus = 'idle' | 'connecting' | 'connected' | 'failed';

const HubManagement = () => {
  // BLE state
  const [bleSupported, setBleSupported] = useState(true);
  const [bleStatus, setBleStatus] = useState<BleStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);

  // WiFi state
  const [wifiStatus, setWifiStatus] = useState<WifiStatus>('idle');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // BLE references
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const credentialsCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const statusCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  // Check Web Bluetooth support on mount
  useEffect(() => {
    if (!navigator.bluetooth) {
      setBleSupported(false);
    }
  }, []);

  // Handle WiFi status changes from ESP32
  const handleStatusChange = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const status = target.value?.getUint8(0);
    updateWifiStatus(status ?? STATUS_IDLE);
  }, []);

  const updateWifiStatus = (status: number) => {
    setIsSaving(false);

    switch (status) {
      case STATUS_IDLE:
        setWifiStatus('idle');
        break;
      case STATUS_CONNECTING:
        setWifiStatus('connecting');
        setIsSaving(true);
        break;
      case STATUS_CONNECTED:
        setWifiStatus('connected');
        setSuccess('Successfully connected to WiFi!');
        setError(null);
        break;
      case STATUS_FAILED:
        setWifiStatus('failed');
        setError('Failed to connect to WiFi. Check credentials and try again.');
        setSuccess(null);
        break;
      default:
        setWifiStatus('idle');
    }
  };

  // Handle unexpected disconnection
  const handleDisconnected = useCallback(() => {
    setBleStatus('disconnected');
    setDeviceName(null);
    setWifiStatus('idle');
    deviceRef.current = null;
    credentialsCharRef.current = null;
    statusCharRef.current = null;
  }, []);

  // Connect to ESP32 hub
  const connect = async () => {
    try {
      setError(null);
      setSuccess(null);
      setBleStatus('connecting');

      // Request device with service filter
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }]
      });

      device.addEventListener('gattserverdisconnected', handleDisconnected);
      deviceRef.current = device;

      // Connect to GATT server
      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');

      // Get service and characteristics
      const service = await server.getPrimaryService(SERVICE_UUID);
      const credentialsChar = await service.getCharacteristic(CREDENTIALS_CHAR_UUID);
      const statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);

      credentialsCharRef.current = credentialsChar;
      statusCharRef.current = statusChar;

      // Subscribe to status notifications
      await statusChar.startNotifications();
      statusChar.addEventListener('characteristicvaluechanged', handleStatusChange);

      // Read initial status
      const statusValue = await statusChar.readValue();
      updateWifiStatus(statusValue.getUint8(0));

      setBleStatus('connected');
      setDeviceName(device.name || 'AutoPrintFarm Hub');

    } catch (err) {
      console.error('BLE connection error:', err);
      setBleStatus('disconnected');
      if (err instanceof Error) {
        // Don't show error if user cancelled the device picker
        if (!err.message.includes('User cancelled')) {
          setError('Failed to connect: ' + err.message);
        }
      }
    }
  };

  // Disconnect from hub
  const disconnect = () => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    handleDisconnected();
  };

  // Send WiFi credentials to hub
  const saveCredentials = async () => {
    if (!credentialsCharRef.current) return;

    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      setError('Please enter a network name');
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setIsSaving(true);

      const credentials = JSON.stringify({ ssid: trimmedSsid, password });
      const encoder = new TextEncoder();
      await credentialsCharRef.current.writeValue(encoder.encode(credentials));

    } catch (err) {
      console.error('Save credentials error:', err);
      setError('Failed to send credentials: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setIsSaving(false);
    }
  };

  // Clear stored WiFi credentials
  const clearCredentials = async () => {
    if (!credentialsCharRef.current) return;

    if (!confirm('Clear saved WiFi credentials? The hub will disconnect from WiFi.')) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setIsClearing(true);

      const encoder = new TextEncoder();
      await credentialsCharRef.current.writeValue(encoder.encode('{"clear":true}'));

      setSuccess('WiFi credentials cleared');
      setSsid('');
      setPassword('');

    } catch (err) {
      console.error('Clear credentials error:', err);
      setError('Failed to clear credentials: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsClearing(false);
    }
  };

  // Get BLE status badge
  const getBleStatusBadge = () => {
    switch (bleStatus) {
      case 'disconnected':
        return <Badge variant="secondary" className="gap-1"><BluetoothOff className="h-3 w-3" /> Disconnected</Badge>;
      case 'connecting':
        return <Badge className="bg-yellow-500 text-white gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Connecting...</Badge>;
      case 'connected':
        return <Badge className="bg-green-600 text-white gap-1"><BluetoothConnected className="h-3 w-3" /> {deviceName}</Badge>;
    }
  };

  // Get WiFi status badge
  const getWifiStatusBadge = () => {
    switch (wifiStatus) {
      case 'idle':
        return <Badge variant="secondary" className="gap-1"><WifiOff className="h-3 w-3" /> Not Connected</Badge>;
      case 'connecting':
        return <Badge className="bg-yellow-500 text-white gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Connecting...</Badge>;
      case 'connected':
        return <Badge className="bg-green-600 text-white gap-1"><Wifi className="h-3 w-3" /> Connected</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Failed</Badge>;
    }
  };

  const canSave = ssid.trim().length > 0 && !isSaving && bleStatus === 'connected';

  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hub Management</h1>
        <p className="text-muted-foreground">Configure your AutoPrintFarm Hub via Bluetooth</p>
      </div>

      {/* Browser warning */}
      {!bleSupported && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Web Bluetooth is not supported in this browser. Please use <strong>Chrome</strong>, <strong>Edge</strong>, or <strong>Opera</strong>.
          </AlertDescription>
        </Alert>
      )}

      {/* BLE Connection Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bluetooth className="h-5 w-5" />
              Device Connection
            </CardTitle>
            {getBleStatusBadge()}
          </div>
          <CardDescription>
            Connect to your hub to configure WiFi settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bleStatus === 'connected' ? (
            <Button
              variant="outline"
              onClick={disconnect}
              className="w-full"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              onClick={connect}
              disabled={!bleSupported || bleStatus === 'connecting'}
              className="w-full"
            >
              {bleStatus === 'connecting' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Bluetooth className="mr-2 h-4 w-4" />
                  Connect to Hub
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* WiFi Configuration Card - only visible when connected */}
      {bleStatus === 'connected' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wifi className="h-5 w-5" />
                WiFi Configuration
              </CardTitle>
              {getWifiStatusBadge()}
            </div>
            <CardDescription>
              Enter your WiFi credentials to connect the hub to your network
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Error/Success messages */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="border-green-600 bg-green-600/10">
                <AlertDescription className="text-green-600">{success}</AlertDescription>
              </Alert>
            )}

            {/* WiFi form */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="ssid">Network Name (SSID)</Label>
                <Input
                  id="ssid"
                  placeholder="Enter WiFi network name"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter WiFi password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={saveCredentials}
                disabled={!canSave}
                className="w-full"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect to WiFi'
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={clearCredentials}
                disabled={isClearing}
                className="w-full"
              >
                {isClearing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  'Clear WiFi Credentials'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help text */}
      <p className="text-sm text-muted-foreground text-center">
        Make sure your AutoPrintFarm Hub is powered on and nearby.
      </p>
    </div>
  );
};

export default HubManagement;
