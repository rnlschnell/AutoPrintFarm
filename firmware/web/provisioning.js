// =============================================================================
// AutoPrintFarm Hub - Web Bluetooth Provisioning
// =============================================================================

// BLE UUIDs (must match ESP32 config.h)
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID_SSID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_PASSWORD = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_COMMAND = 'beb54840-36e1-4688-b7f5-ea07361b26a8';
const CHAR_UUID_STATUS = 'beb54841-36e1-4688-b7f5-ea07361b26a8';

// Commands
const CMD_CONNECT = 0x01;
const CMD_DISCONNECT = 0x02;
const CMD_CLEAR = 0xFF;

// Status values
const STATUS_IDLE = 0x00;
const STATUS_CONNECTING = 0x01;
const STATUS_CONNECTED = 0x02;
const STATUS_FAILED = 0x03;
const STATUS_DISCONNECTED = 0x04;
const STATUS_NO_CREDENTIALS = 0x05;

// Global state
let bleDevice = null;
let bleServer = null;
let ssidCharacteristic = null;
let passwordCharacteristic = null;
let commandCharacteristic = null;
let statusCharacteristic = null;

// =============================================================================
// Logging
// =============================================================================

function log(message, type = 'info') {
    const logSection = document.getElementById('logSection');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logSection.appendChild(entry);
    logSection.scrollTop = logSection.scrollHeight;
    console.log(`[${type}] ${message}`);
}

// =============================================================================
// UI Updates
// =============================================================================

function updateBleStatus(connected) {
    const indicator = document.getElementById('bleIndicator');
    const status = document.getElementById('bleStatus');
    const connectSection = document.getElementById('connectSection');
    const wifiSection = document.getElementById('wifiSection');

    if (connected) {
        indicator.className = 'status-indicator connected';
        status.textContent = 'Connected';
        connectSection.classList.add('hidden');
        wifiSection.classList.remove('hidden');
    } else {
        indicator.className = 'status-indicator';
        status.textContent = 'Not Connected';
        connectSection.classList.remove('hidden');
        wifiSection.classList.add('hidden');
    }
}

function updateWifiStatus(statusCode) {
    const indicator = document.getElementById('wifiIndicator');
    const status = document.getElementById('wifiStatus');

    const statusMap = {
        [STATUS_IDLE]: { text: 'Idle', class: '' },
        [STATUS_CONNECTING]: { text: 'Connecting...', class: 'connecting' },
        [STATUS_CONNECTED]: { text: 'Connected', class: 'connected' },
        [STATUS_FAILED]: { text: 'Connection Failed', class: 'error' },
        [STATUS_DISCONNECTED]: { text: 'Disconnected', class: '' },
        [STATUS_NO_CREDENTIALS]: { text: 'No Credentials', class: '' }
    };

    const info = statusMap[statusCode] || { text: `Unknown (${statusCode})`, class: '' };
    indicator.className = `status-indicator ${info.class}`;
    status.textContent = info.text;
}

// =============================================================================
// BLE Connection
// =============================================================================

async function connectToBLE() {
    try {
        log('Requesting BLE device...', 'info');

        // Request the device with our service UUID
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        log(`Found device: ${bleDevice.name}`, 'success');

        // Set up disconnect handler
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        // Connect to GATT server
        log('Connecting to GATT server...', 'info');
        bleServer = await bleDevice.gatt.connect();
        log('Connected to GATT server', 'success');

        // Get the WiFi provisioning service
        log('Getting WiFi provisioning service...', 'info');
        const service = await bleServer.getPrimaryService(SERVICE_UUID);

        // Get all characteristics
        log('Getting characteristics...', 'info');
        ssidCharacteristic = await service.getCharacteristic(CHAR_UUID_SSID);
        passwordCharacteristic = await service.getCharacteristic(CHAR_UUID_PASSWORD);
        commandCharacteristic = await service.getCharacteristic(CHAR_UUID_COMMAND);
        statusCharacteristic = await service.getCharacteristic(CHAR_UUID_STATUS);

        // Subscribe to status notifications
        await statusCharacteristic.startNotifications();
        statusCharacteristic.addEventListener('characteristicvaluechanged', handleStatusNotification);

        // Read initial status
        const statusValue = await statusCharacteristic.readValue();
        updateWifiStatus(statusValue.getUint8(0));

        // Try to read stored SSID
        try {
            const ssidValue = await ssidCharacteristic.readValue();
            const storedSsid = new TextDecoder().decode(ssidValue);
            // Validate SSID: must be non-empty and contain only printable ASCII characters
            // This filters out garbage/uninitialized data from BLE characteristic buffer
            if (storedSsid && /^[\x20-\x7E]+$/.test(storedSsid)) {
                document.getElementById('ssid').value = storedSsid;
                log(`Stored SSID: ${storedSsid}`, 'info');
            }
        } catch (e) {
            // SSID might be empty
        }

        updateBleStatus(true);
        log('Ready to configure WiFi!', 'success');

    } catch (error) {
        log(`Connection failed: ${error.message}`, 'error');
        console.error(error);
    }
}

function onDisconnected(event) {
    log('Disconnected from Hub', 'info');
    updateBleStatus(false);
    updateWifiStatus(STATUS_IDLE);
    bleDevice = null;
    bleServer = null;
    ssidCharacteristic = null;
    passwordCharacteristic = null;
    commandCharacteristic = null;
    statusCharacteristic = null;
}

async function disconnectBLE() {
    if (bleDevice && bleDevice.gatt.connected) {
        log('Disconnecting...', 'info');
        bleDevice.gatt.disconnect();
    }
}

// =============================================================================
// WiFi Configuration
// =============================================================================

async function saveAndConnect() {
    const ssid = document.getElementById('ssid').value.trim();
    const password = document.getElementById('password').value;

    if (!ssid) {
        log('Please enter a WiFi network name', 'error');
        return;
    }

    try {
        // Write SSID
        log(`Setting SSID: ${ssid}`, 'info');
        const ssidEncoder = new TextEncoder();
        await ssidCharacteristic.writeValue(ssidEncoder.encode(ssid));

        // Write password
        log('Setting password...', 'info');
        const passEncoder = new TextEncoder();
        await passwordCharacteristic.writeValue(passEncoder.encode(password));

        // Send connect command
        log('Sending connect command...', 'info');
        await commandCharacteristic.writeValue(new Uint8Array([CMD_CONNECT]));

        log('WiFi connection initiated', 'success');

    } catch (error) {
        log(`Error: ${error.message}`, 'error');
        console.error(error);
    }
}

async function disconnectWifi() {
    try {
        log('Sending disconnect command...', 'info');
        await commandCharacteristic.writeValue(new Uint8Array([CMD_DISCONNECT]));
        log('WiFi disconnect requested', 'info');
    } catch (error) {
        log(`Error: ${error.message}`, 'error');
        console.error(error);
    }
}

// =============================================================================
// Status Notifications
// =============================================================================

function handleStatusNotification(event) {
    const value = event.target.value;
    const status = value.getUint8(0);

    const statusNames = {
        [STATUS_IDLE]: 'IDLE',
        [STATUS_CONNECTING]: 'CONNECTING',
        [STATUS_CONNECTED]: 'CONNECTED',
        [STATUS_FAILED]: 'FAILED',
        [STATUS_DISCONNECTED]: 'DISCONNECTED',
        [STATUS_NO_CREDENTIALS]: 'NO_CREDENTIALS'
    };

    const statusName = statusNames[status] || `UNKNOWN(${status})`;
    log(`Status update: ${statusName}`, status === STATUS_CONNECTED ? 'success' : 'info');
    updateWifiStatus(status);
}

// =============================================================================
// Check Web Bluetooth Support
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.bluetooth) {
        log('Web Bluetooth is not supported in this browser!', 'error');
        log('Please use Chrome or Edge on desktop/Android', 'error');
        document.getElementById('connectBtn').disabled = true;
    }
});
