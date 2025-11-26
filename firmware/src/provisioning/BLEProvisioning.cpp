#include "BLEProvisioning.h"
#include "../PrinterManager.h"
#include "../tunnel/TunnelConfigStore.h"
#include "../tunnel/TunnelClient.h"
#include "PrinterConfigStore.h"
#include <ArduinoJson.h>

// Static pointer for callbacks to access the instance
static BLEProvisioning* _instance = nullptr;

// Server callbacks for connect/disconnect events
class BLEProvisioning::ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
        Serial.printf("[BLE] Client connected: %s\n", connInfo.getAddress().toString().c_str());
    }

    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
        Serial.printf("[BLE] Client disconnected, reason: %d\n", reason);
        NimBLEDevice::startAdvertising();
    }
};

// Credentials characteristic callback - receives JSON {"ssid":"...","password":"..."}
class BLEProvisioning::CredentialsCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
        if (!_instance) return;

        std::string value = pCharacteristic->getValue();
        Serial.printf("[BLE] Credentials received: %d bytes\n", value.length());

        // Parse JSON
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, value.c_str());

        if (error) {
            Serial.printf("[BLE] JSON parse error: %s\n", error.c_str());
            _instance->updateStatus(STATUS_FAILED);
            return;
        }

        // Check for clear command
        if (doc["clear"] | false) {
            Serial.println("[BLE] Clearing WiFi credentials");
            _instance->_wifiManager.disconnect();
            _instance->_wifiManager.clearStoredCredentials();
            _instance->updateStatus(STATUS_IDLE);
            return;
        }

        // Extract SSID and password
        const char* ssid = doc["ssid"] | "";
        const char* password = doc["password"] | "";

        if (strlen(ssid) == 0) {
            Serial.println("[BLE] Error: SSID is empty");
            _instance->updateStatus(STATUS_FAILED);
            return;
        }

        _instance->_pendingSSID = ssid;
        _instance->_pendingPassword = password;
        _instance->_connectRequested = true;

        Serial.printf("[BLE] Will connect to: %s\n", ssid);
    }
};

// Printer config characteristic callback
// Accepts JSON:
// - Add printer: {"action":"add","type":"bambu","name":"...","ip":"...","accessCode":"...","serial":"..."}
// - Remove printer: {"action":"remove","slot":0}
// - List printers: {"action":"list"}
class BLEProvisioning::PrinterConfigCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
        if (!_instance) return;

        std::string value = pCharacteristic->getValue();
        Serial.printf("[BLE] Printer config received: %d bytes\n", value.length());

        // Store the raw JSON for deferred processing
        _instance->_pendingPrinterConfig = String(value.c_str());
        _instance->_printerConfigRequested = true;
    }
};

// Cloud config characteristic callback
// Accepts JSON: {"tenant_id":"...","claim_token":"...","api_url":"..."}
// This allows the mobile app to configure the hub's cloud connection
class BLEProvisioning::CloudConfigCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
        if (!_instance) return;

        std::string value = pCharacteristic->getValue();
        Serial.printf("[BLE] Cloud config received: %d bytes\n", value.length());

        // Store the raw JSON for deferred processing
        _instance->_pendingCloudConfig = String(value.c_str());
        _instance->_cloudConfigRequested = true;
    }
};

BLEProvisioning::BLEProvisioning(WiFiManager& wifiManager)
    : _wifiManager(wifiManager)
    , _printerManager(nullptr)
    , _tunnelConfigStore(nullptr)
    , _tunnelClient(nullptr)
    , _running(false)
    , _pServer(nullptr)
    , _pService(nullptr)
    , _pCredentialsChar(nullptr)
    , _pStatusChar(nullptr)
    , _pPrinterConfigChar(nullptr)
    , _pPrinterStatusChar(nullptr)
    , _pCloudConfigChar(nullptr)
    , _connectRequested(false)
    , _printerConfigRequested(false)
    , _cloudConfigRequested(false)
{
    _instance = this;
}

void BLEProvisioning::setPrinterManager(PrinterManager* printerManager) {
    _printerManager = printerManager;
}

void BLEProvisioning::setTunnelConfigStore(TunnelConfigStore* tunnelConfigStore) {
    _tunnelConfigStore = tunnelConfigStore;
}

void BLEProvisioning::setTunnelClient(TunnelClient* tunnelClient) {
    _tunnelClient = tunnelClient;
}

void BLEProvisioning::begin(const char* deviceName) {
    Serial.printf("[BLE] Initializing with name: %s\n", deviceName);

    // Initialize BLE
    NimBLEDevice::init(deviceName);

    // Print BLE address for debugging
    Serial.printf("[BLE] Address: %s\n", NimBLEDevice::getAddress().toString().c_str());

    // Set power level
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);

    // Create server
    _pServer = NimBLEDevice::createServer();
    _pServer->setCallbacks(new ServerCallbacks());

    // Create service
    _pService = _pServer->createService(PROV_SERVICE_UUID);

    // Credentials characteristic - write only, receives JSON
    _pCredentialsChar = _pService->createCharacteristic(
        CREDENTIALS_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE
    );
    _pCredentialsChar->setCallbacks(new CredentialsCallbacks());

    // Status characteristic - read and notify
    _pStatusChar = _pService->createCharacteristic(
        STATUS_CHAR_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
    );
    uint8_t initialStatus = _wifiManager.isConnected() ? STATUS_CONNECTED : STATUS_IDLE;
    _pStatusChar->setValue(&initialStatus, 1);

    // Printer config characteristic - write only, receives JSON
    _pPrinterConfigChar = _pService->createCharacteristic(
        PRINTER_CONFIG_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE
    );
    _pPrinterConfigChar->setCallbacks(new PrinterConfigCallbacks());

    // Printer status characteristic - read and notify, returns JSON
    _pPrinterStatusChar = _pService->createCharacteristic(
        PRINTER_STATUS_CHAR_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
    );
    _pPrinterStatusChar->setValue("{}");

    // Cloud config characteristic - write only, receives JSON
    // {"tenant_id":"...","claim_token":"...","api_url":"..."}
    _pCloudConfigChar = _pService->createCharacteristic(
        CLOUD_CONFIG_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE
    );
    _pCloudConfigChar->setCallbacks(new CloudConfigCallbacks());

    // Start service
    _pService->start();

    // Configure advertising - split data to fit in 31-byte limit
    NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();

    NimBLEAdvertisementData advData;
    advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
    advData.setCompleteServices(NimBLEUUID(PROV_SERVICE_UUID));
    pAdvertising->setAdvertisementData(advData);

    NimBLEAdvertisementData scanData;
    scanData.setName(deviceName);
    pAdvertising->setScanResponseData(scanData);

    // Start advertising
    bool started = pAdvertising->start();
    _running = true;

    Serial.printf("[BLE] Advertising: %s\n", started ? "OK" : "FAILED");
}

void BLEProvisioning::stop() {
    if (_running) {
        NimBLEDevice::stopAdvertising();
        NimBLEDevice::deinit(true);
        _running = false;
        Serial.println("[BLE] Stopped");
    }
}

bool BLEProvisioning::isClientConnected() const {
    return _pServer != nullptr && _pServer->getConnectedCount() > 0;
}

void BLEProvisioning::updateStatus(uint8_t status) {
    if (_pStatusChar) {
        _pStatusChar->setValue(&status, 1);
        _pStatusChar->notify();
        Serial.printf("[BLE] Status: 0x%02X\n", status);
    }
}

void BLEProvisioning::updatePrinterStatus() {
    if (!_pPrinterStatusChar || !_printerManager) return;

    // Build JSON response with all printer statuses
    JsonDocument doc;
    JsonArray printers = doc["printers"].to<JsonArray>();

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        PrinterStatus status;
        if (_printerManager->getPrinterStatus(i, status)) {
            JsonObject printer = printers.add<JsonObject>();
            printer["slot"] = i;
            printer["name"] = _printerManager->getPrinter(i)->getPrinterName();
            printer["type"] = status.printerType;
            printer["connected"] = status.connected;
            printer["state"] = PrinterStatus::stateToString(status.state);
            printer["nozzleTemp"] = status.nozzleTemp;
            printer["nozzleTarget"] = status.nozzleTarget;
            printer["bedTemp"] = status.bedTemp;
            printer["bedTarget"] = status.bedTarget;
        }
    }

    String jsonStr;
    serializeJson(doc, jsonStr);

    _pPrinterStatusChar->setValue(jsonStr.c_str());
    _pPrinterStatusChar->notify();
}

void BLEProvisioning::performConnect() {
    if (_pendingSSID.length() == 0) {
        Serial.println("[BLE] No SSID to connect to");
        updateStatus(STATUS_FAILED);
        return;
    }

    updateStatus(STATUS_CONNECTING);

    bool success = _wifiManager.connect(_pendingSSID, _pendingPassword, true);

    if (success) {
        updateStatus(STATUS_CONNECTED);
        Serial.printf("[BLE] Connected! IP: %s\n", _wifiManager.getIPAddress().c_str());
    } else {
        updateStatus(STATUS_FAILED);
    }

    // Clear password from memory
    _pendingPassword = "";
}

void BLEProvisioning::processPrinterConfig() {
    if (!_printerManager) {
        Serial.println("[BLE] PrinterManager not set, cannot process printer config");
        return;
    }

    // Parse JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, _pendingPrinterConfig);

    if (error) {
        Serial.printf("[BLE] Printer config JSON parse error: %s\n", error.c_str());
        return;
    }

    const char* action = doc["action"] | "";

    if (strcmp(action, "add") == 0) {
        // Add a new printer
        PrinterConfig config;
        config.type = doc["type"] | "bambu";
        config.name = doc["name"] | "Printer";
        config.ip = doc["ip"] | "";
        config.accessCode = doc["accessCode"] | "";
        config.serial = doc["serial"] | "";
        config.port = doc["port"] | 0;
        config.apiKey = doc["apiKey"] | "";

        if (config.ip.length() == 0) {
            Serial.println("[BLE] Printer IP is required");
            return;
        }

        // For Bambu, validate required fields
        if (config.type == "bambu") {
            if (config.accessCode.length() == 0 || config.serial.length() == 0) {
                Serial.println("[BLE] Bambu printer requires accessCode and serial");
                return;
            }
        }

        int8_t slot = _printerManager->addPrinter(config);
        if (slot >= 0) {
            Serial.printf("[BLE] Printer added to slot %d\n", slot);
            updatePrinterStatus();
        } else {
            Serial.println("[BLE] Failed to add printer");
        }

    } else if (strcmp(action, "remove") == 0) {
        // Remove a printer
        uint8_t slot = doc["slot"] | 0;
        _printerManager->removePrinter(slot);
        Serial.printf("[BLE] Printer removed from slot %d\n", slot);
        updatePrinterStatus();

    } else if (strcmp(action, "list") == 0) {
        // Just update and notify the status
        updatePrinterStatus();
        Serial.println("[BLE] Printer list requested");

    } else if (strcmp(action, "light") == 0) {
        // Control printer light
        uint8_t slot = doc["slot"] | 0;
        bool on = doc["on"] | true;

        PrinterClient* printer = _printerManager->getPrinter(slot);
        if (printer && printer->isConnected()) {
            if (printer->setLight(on)) {
                Serial.printf("[BLE] Light %s for printer in slot %d\n", on ? "ON" : "OFF", slot);
            } else {
                Serial.printf("[BLE] Failed to set light for slot %d\n", slot);
            }
        } else {
            Serial.printf("[BLE] Printer in slot %d not connected\n", slot);
        }

    } else {
        Serial.printf("[BLE] Unknown printer config action: %s\n", action);
    }

    // Clear the pending config
    _pendingPrinterConfig = "";
}

void BLEProvisioning::poll() {
    // Process WiFi connect request (deferred from callback)
    if (_connectRequested) {
        _connectRequested = false;
        performConnect();
    }

    // Process printer config request (deferred from callback)
    if (_printerConfigRequested) {
        _printerConfigRequested = false;
        processPrinterConfig();
    }

    // Process cloud config request (deferred from callback)
    if (_cloudConfigRequested) {
        _cloudConfigRequested = false;
        processCloudConfig();
    }

    // Sync status with WiFi state
    static bool lastConnected = false;
    bool nowConnected = _wifiManager.isConnected();

    if (nowConnected != lastConnected) {
        updateStatus(nowConnected ? STATUS_CONNECTED : STATUS_IDLE);
        lastConnected = nowConnected;
    }

    // Periodically update printer status if client is connected
    static unsigned long lastPrinterStatusUpdate = 0;
    if (isClientConnected() && _printerManager) {
        unsigned long now = millis();
        if (now - lastPrinterStatusUpdate > 5000) {  // Every 5 seconds
            lastPrinterStatusUpdate = now;
            updatePrinterStatus();
        }
    }
}

void BLEProvisioning::processCloudConfig() {
    if (!_tunnelConfigStore) {
        Serial.println("[BLE] TunnelConfigStore not set, cannot process cloud config");
        return;
    }

    // Parse JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, _pendingCloudConfig);

    if (error) {
        Serial.printf("[BLE] Cloud config JSON parse error: %s\n", error.c_str());
        return;
    }

    const char* tenantId = doc["tenant_id"] | "";
    const char* claimToken = doc["claim_token"] | "";
    const char* apiUrl = doc["api_url"] | "";

    Serial.printf("[BLE] Cloud config - tenant: %s, api_url: %s\n", tenantId, apiUrl);

    if (strlen(tenantId) == 0 || strlen(apiUrl) == 0) {
        Serial.println("[BLE] Error: tenant_id and api_url are required");
        return;
    }

    // Save the cloud configuration
    bool success = _tunnelConfigStore->setCloudConfig(
        String(tenantId),
        String(claimToken),
        String(apiUrl)
    );

    if (success) {
        Serial.println("[BLE] Cloud config saved successfully");

        // If we have a tunnel client and WiFi is connected, trigger reconnect
        if (_tunnelClient && _wifiManager.isConnected()) {
            Serial.println("[BLE] Triggering tunnel reconnect with new config...");
            _tunnelClient->disconnect();
            // The main loop will handle reconnection
        }
    } else {
        Serial.println("[BLE] Failed to save cloud config");
    }

    // Clear the pending config
    _pendingCloudConfig = "";
}
