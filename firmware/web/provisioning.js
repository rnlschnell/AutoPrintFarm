// BLE UUIDs - must match ESP32 firmware
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CREDENTIALS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const STATUS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const PRINTER_CONFIG_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';
const PRINTER_STATUS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ad';

// Status codes
const STATUS_IDLE = 0x00;
const STATUS_CONNECTING = 0x02;
const STATUS_CONNECTED = 0x03;
const STATUS_FAILED = 0x04;

// DOM Elements - Connection
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const bleStatusDot = document.getElementById('bleStatusDot');
const bleStatusText = document.getElementById('bleStatusText');
const browserWarning = document.getElementById('browserWarning');

// DOM Elements - Tabs
const tabButtons = document.getElementById('tabButtons');
const wifiTabBtn = document.getElementById('wifiTabBtn');
const printerTabBtn = document.getElementById('printerTabBtn');

// DOM Elements - WiFi
const wifiCard = document.getElementById('wifiCard');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const ssidInput = document.getElementById('ssid');
const passwordInput = document.getElementById('password');
const wifiStatusDot = document.getElementById('wifiStatusDot');
const wifiStatusText = document.getElementById('wifiStatusText');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

// DOM Elements - Printer
const printerCard = document.getElementById('printerCard');
const printerList = document.getElementById('printerList');
const showAddPrinterBtn = document.getElementById('showAddPrinterBtn');
const addPrinterForm = document.getElementById('addPrinterForm');
const addPrinterBtn = document.getElementById('addPrinterBtn');
const cancelAddPrinterBtn = document.getElementById('cancelAddPrinterBtn');
const printerNameInput = document.getElementById('printerName');
const printerIPInput = document.getElementById('printerIP');
const printerAccessCodeInput = document.getElementById('printerAccessCode');
const printerSerialInput = document.getElementById('printerSerial');
const printerErrorMessage = document.getElementById('printerErrorMessage');
const printerSuccessMessage = document.getElementById('printerSuccessMessage');

// BLE state
let device = null;
let server = null;
let service = null;
let credentialsChar = null;
let statusChar = null;
let printerConfigChar = null;
let printerStatusChar = null;

// Check Web Bluetooth support
if (!navigator.bluetooth) {
    browserWarning.classList.remove('hidden');
    connectBtn.disabled = true;
}

// Event listeners - Connection
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

// Event listeners - Tabs
wifiTabBtn.addEventListener('click', () => switchTab('wifi'));
printerTabBtn.addEventListener('click', () => switchTab('printer'));

// Event listeners - WiFi
saveBtn.addEventListener('click', saveCredentials);
clearBtn.addEventListener('click', clearCredentials);
ssidInput.addEventListener('input', validateWiFiForm);
passwordInput.addEventListener('input', validateWiFiForm);

// Event listeners - Printer
showAddPrinterBtn.addEventListener('click', showAddPrinterForm);
cancelAddPrinterBtn.addEventListener('click', hideAddPrinterForm);
addPrinterBtn.addEventListener('click', addPrinter);
printerNameInput.addEventListener('input', validatePrinterForm);
printerIPInput.addEventListener('input', validatePrinterForm);
printerAccessCodeInput.addEventListener('input', validatePrinterForm);
printerSerialInput.addEventListener('input', validatePrinterForm);

function switchTab(tab) {
    if (tab === 'wifi') {
        wifiTabBtn.classList.add('active');
        printerTabBtn.classList.remove('active');
        wifiCard.classList.remove('hidden');
        printerCard.classList.add('hidden');
    } else {
        printerTabBtn.classList.add('active');
        wifiTabBtn.classList.remove('active');
        printerCard.classList.remove('hidden');
        wifiCard.classList.add('hidden');
        // Request printer list when switching to printer tab
        requestPrinterList();
    }
}

async function connect() {
    try {
        hideMessages();
        setBLEStatus('connecting', 'Connecting...');

        // Request device - filter by service UUID
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }]
        });

        device.addEventListener('gattserverdisconnected', onDisconnected);

        // Connect to GATT server
        server = await device.gatt.connect();

        // Get service and characteristics
        service = await server.getPrimaryService(SERVICE_UUID);
        credentialsChar = await service.getCharacteristic(CREDENTIALS_CHAR_UUID);
        statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);

        // Try to get printer characteristics (may not exist on older firmware)
        try {
            printerConfigChar = await service.getCharacteristic(PRINTER_CONFIG_CHAR_UUID);
            printerStatusChar = await service.getCharacteristic(PRINTER_STATUS_CHAR_UUID);

            // Subscribe to printer status notifications
            await printerStatusChar.startNotifications();
            printerStatusChar.addEventListener('characteristicvaluechanged', onPrinterStatusChanged);
        } catch (e) {
            console.log('Printer characteristics not available:', e.message);
            printerConfigChar = null;
            printerStatusChar = null;
        }

        // Subscribe to WiFi status notifications
        await statusChar.startNotifications();
        statusChar.addEventListener('characteristicvaluechanged', onStatusChanged);

        // Read initial status
        const statusValue = await statusChar.readValue();
        updateWiFiStatus(statusValue.getUint8(0));

        // Update UI
        setBLEStatus('connected', `Connected to ${device.name}`);
        connectBtn.classList.add('hidden');
        disconnectBtn.classList.remove('hidden');
        tabButtons.classList.remove('hidden');
        wifiCard.classList.remove('hidden');
        validateWiFiForm();

        // If printer characteristics are available, request initial list
        if (printerConfigChar) {
            setTimeout(requestPrinterList, 500);
        }

    } catch (error) {
        console.error('Connection error:', error);
        setBLEStatus('failed', 'Connection failed');
        showError('Failed to connect: ' + error.message);
    }
}

function disconnect() {
    if (device && device.gatt.connected) {
        device.gatt.disconnect();
    }
}

function onDisconnected() {
    setBLEStatus('disconnected', 'Disconnected');
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
    tabButtons.classList.add('hidden');
    wifiCard.classList.add('hidden');
    printerCard.classList.add('hidden');

    device = null;
    server = null;
    service = null;
    credentialsChar = null;
    statusChar = null;
    printerConfigChar = null;
    printerStatusChar = null;
}

// ========== WiFi Functions ==========

function validateWiFiForm() {
    const hasSSID = ssidInput.value.trim().length > 0;
    saveBtn.disabled = !hasSSID;
}

async function saveCredentials() {
    try {
        hideMessages();

        const ssid = ssidInput.value.trim();
        const password = passwordInput.value;

        if (!ssid) {
            showError('Please enter a network name');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Connecting...';

        // Send credentials as JSON - single write triggers connection
        const credentials = JSON.stringify({ ssid, password });
        const encoder = new TextEncoder();
        await credentialsChar.writeValue(encoder.encode(credentials));

    } catch (error) {
        console.error('Save error:', error);
        showError('Failed to send credentials: ' + error.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Connect to WiFi';
    }
}

async function clearCredentials() {
    try {
        if (!confirm('Clear saved WiFi credentials? The device will disconnect from WiFi.')) {
            return;
        }

        hideMessages();
        clearBtn.disabled = true;
        clearBtn.textContent = 'Clearing...';

        // Send clear command as JSON
        const encoder = new TextEncoder();
        await credentialsChar.writeValue(encoder.encode('{"clear":true}'));

        showSuccess('WiFi credentials cleared');
    } catch (error) {
        console.error('Clear error:', error);
        showError('Failed to clear credentials: ' + error.message);
    } finally {
        clearBtn.disabled = false;
        clearBtn.textContent = 'Clear WiFi Credentials';
    }
}

function onStatusChanged(event) {
    const status = event.target.value.getUint8(0);
    updateWiFiStatus(status);
}

function updateWiFiStatus(status) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Connect to WiFi';

    switch (status) {
        case STATUS_IDLE:
            setWiFiStatus('disconnected', 'WiFi: Not connected');
            break;

        case STATUS_CONNECTING:
            setWiFiStatus('connecting', 'WiFi: Connecting...');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Connecting...';
            break;

        case STATUS_CONNECTED:
            setWiFiStatus('connected', 'WiFi: Connected!');
            showSuccess('Successfully connected to WiFi!');
            break;

        case STATUS_FAILED:
            setWiFiStatus('failed', 'WiFi: Connection failed');
            showError('Failed to connect. Check credentials and try again.');
            break;

        default:
            setWiFiStatus('disconnected', 'WiFi: Unknown');
    }
}

// ========== Printer Functions ==========

function validatePrinterForm() {
    const hasName = printerNameInput.value.trim().length > 0;
    const hasIP = printerIPInput.value.trim().length > 0;
    const hasAccessCode = printerAccessCodeInput.value.trim().length === 8;
    const hasSerial = printerSerialInput.value.trim().length >= 10;

    addPrinterBtn.disabled = !(hasName && hasIP && hasAccessCode && hasSerial);
}

function showAddPrinterForm() {
    addPrinterForm.classList.remove('hidden');
    showAddPrinterBtn.classList.add('hidden');
    hidePrinterMessages();
}

function hideAddPrinterForm() {
    addPrinterForm.classList.add('hidden');
    showAddPrinterBtn.classList.remove('hidden');

    // Clear form
    printerNameInput.value = '';
    printerIPInput.value = '';
    printerAccessCodeInput.value = '';
    printerSerialInput.value = '';
    addPrinterBtn.disabled = true;
}

async function addPrinter() {
    if (!printerConfigChar) {
        showPrinterError('Printer configuration not supported on this device');
        return;
    }

    try {
        hidePrinterMessages();
        addPrinterBtn.disabled = true;
        addPrinterBtn.textContent = 'Adding...';

        const config = {
            action: 'add',
            type: 'bambu',
            name: printerNameInput.value.trim(),
            ip: printerIPInput.value.trim(),
            accessCode: printerAccessCodeInput.value.trim(),
            serial: printerSerialInput.value.trim()
        };

        const encoder = new TextEncoder();
        await printerConfigChar.writeValue(encoder.encode(JSON.stringify(config)));

        showPrinterSuccess('Printer added! Connecting...');
        hideAddPrinterForm();

        // Request updated list after a short delay
        setTimeout(requestPrinterList, 1000);

    } catch (error) {
        console.error('Add printer error:', error);
        showPrinterError('Failed to add printer: ' + error.message);
    } finally {
        addPrinterBtn.disabled = false;
        addPrinterBtn.textContent = 'Add Bambu Printer';
    }
}

async function removePrinter(slot) {
    if (!printerConfigChar) return;

    if (!confirm('Remove this printer?')) {
        return;
    }

    try {
        const encoder = new TextEncoder();
        await printerConfigChar.writeValue(encoder.encode(JSON.stringify({
            action: 'remove',
            slot: slot
        })));

        showPrinterSuccess('Printer removed');
        setTimeout(requestPrinterList, 500);

    } catch (error) {
        console.error('Remove printer error:', error);
        showPrinterError('Failed to remove printer: ' + error.message);
    }
}

async function toggleLight(slot, turnOn) {
    if (!printerConfigChar) return;

    try {
        const encoder = new TextEncoder();
        await printerConfigChar.writeValue(encoder.encode(JSON.stringify({
            action: 'light',
            slot: slot,
            on: turnOn
        })));

        showPrinterSuccess(`Light turned ${turnOn ? 'on' : 'off'}`);

    } catch (error) {
        console.error('Toggle light error:', error);
        showPrinterError('Failed to toggle light: ' + error.message);
    }
}

async function requestPrinterList() {
    if (!printerConfigChar) return;

    try {
        const encoder = new TextEncoder();
        await printerConfigChar.writeValue(encoder.encode(JSON.stringify({
            action: 'list'
        })));
    } catch (error) {
        console.error('Request printer list error:', error);
    }
}

function onPrinterStatusChanged(event) {
    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(event.target.value);

    try {
        const data = JSON.parse(jsonStr);
        updatePrinterList(data.printers || []);
    } catch (error) {
        console.error('Error parsing printer status:', error);
    }
}

function updatePrinterList(printers) {
    if (printers.length === 0) {
        printerList.innerHTML = '<p style="color: #888; font-size: 0.9rem;">No printers configured</p>';
        return;
    }

    let html = '';
    for (const printer of printers) {
        const statusClass = printer.connected ? 'online' : 'offline';
        const statusText = printer.connected ? `${printer.state}` : 'Offline';
        const lightDisabled = !printer.connected ? 'disabled' : '';

        html += `
            <div class="printer-item">
                <div class="printer-header">
                    <span class="printer-name">${escapeHtml(printer.name)}</span>
                    <span class="printer-type">${printer.type}</span>
                </div>
                <div class="printer-temps">
                    Nozzle: <span class="temp-value">${printer.nozzleTemp.toFixed(1)}/${printer.nozzleTarget.toFixed(0)}°C</span>
                    &nbsp;|&nbsp;
                    Bed: <span class="temp-value">${printer.bedTemp.toFixed(1)}/${printer.bedTarget.toFixed(0)}°C</span>
                </div>
                <div class="printer-status ${statusClass}">${statusText}</div>
                <div class="printer-controls">
                    <button class="light-btn" onclick="toggleLight(${printer.slot}, true)" ${lightDisabled}>Light On</button>
                    <button class="light-btn" onclick="toggleLight(${printer.slot}, false)" ${lightDisabled}>Light Off</button>
                    <button class="remove-btn" onclick="removePrinter(${printer.slot})">Remove</button>
                </div>
            </div>
        `;
    }

    printerList.innerHTML = html;
}

// ========== UI Helper Functions ==========

function setBLEStatus(status, text) {
    bleStatusDot.className = 'status-dot ' + status;
    bleStatusText.textContent = text;
}

function setWiFiStatus(status, text) {
    wifiStatusDot.className = 'status-dot ' + status;
    wifiStatusText.textContent = text;
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
}

function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.remove('hidden');
    errorMessage.classList.add('hidden');
}

function hideMessages() {
    errorMessage.classList.add('hidden');
    successMessage.classList.add('hidden');
}

function showPrinterError(message) {
    printerErrorMessage.textContent = message;
    printerErrorMessage.classList.remove('hidden');
    printerSuccessMessage.classList.add('hidden');
}

function showPrinterSuccess(message) {
    printerSuccessMessage.textContent = message;
    printerSuccessMessage.classList.remove('hidden');
    printerErrorMessage.classList.add('hidden');
}

function hidePrinterMessages() {
    printerErrorMessage.classList.add('hidden');
    printerSuccessMessage.classList.add('hidden');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
