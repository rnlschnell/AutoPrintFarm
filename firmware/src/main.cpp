#include <Arduino.h>
#include "config.h"
#include "provisioning/CredentialStore.h"
#include "provisioning/HubConfigStore.h"
#include "provisioning/BLEProvisioning.h"
#include "cloud/CloudClient.h"
#include "printers/BambuMqttClient.h"

// =============================================================================
// Global Objects
// =============================================================================

CredentialStore credentialStore;
HubConfigStore hubConfigStore;
BLEProvisioning bleProvisioning(credentialStore, hubConfigStore);
CloudClient cloudClient(hubConfigStore);
BambuMqttClient bambuMqtt;

// Track if BLE was stopped after WiFi connect
// NOTE: Currently always keeping BLE active until we add a physical button for pairing mode
bool bleStoppedAfterConnect = false;

// =============================================================================
// Printer Status Callback
// =============================================================================

/**
 * Called by BambuMqttClient when printer status is received
 * Forwards status to cloud via CloudClient
 */
void onPrinterStatus(const PrinterStatus& status) {
    cloudClient.sendPrinterStatus(status);
}

// =============================================================================
// Setup
// =============================================================================

void setup() {
    // Initialize serial
    Serial.begin(115200);
    delay(1000);  // Give serial time to initialize

    Serial.println();
    Serial.println("================================================");
    Serial.println("       AutoPrintFarm Hub - Starting Up");
    Serial.println("================================================");
    Serial.println();

    // Initialize credential store (NVS)
    Serial.println("[Main] Initializing credential store...");
    if (!credentialStore.begin()) {
        Serial.println("[Main] ERROR: Failed to initialize credential store!");
    }

    // Initialize hub config store (NVS)
    Serial.println("[Main] Initializing hub config store...");
    if (!hubConfigStore.begin()) {
        Serial.println("[Main] ERROR: Failed to initialize hub config store!");
    }

    // Initialize BLE provisioning
    Serial.println("[Main] Starting BLE provisioning...");
    bleProvisioning.begin(BLE_DEVICE_NAME);

    // Initialize cloud client
    Serial.println("[Main] Initializing cloud client...");
    cloudClient.begin();

    // Initialize Bambu MQTT client for printer communication
    Serial.println("[Main] Initializing Bambu MQTT client...");
    bambuMqtt.begin();
    bambuMqtt.setStatusCallback(onPrinterStatus);
    cloudClient.setMqttClient(&bambuMqtt);

    // Auto-connect to WiFi if credentials are stored
    if (credentialStore.hasCredentials()) {
        Serial.println("[Main] Found stored WiFi credentials, attempting auto-connect...");
        bleProvisioning.autoConnect();
    } else {
        Serial.println("[Main] No WiFi credentials stored. Use BLE provisioning to configure.");
    }

    Serial.println();
    Serial.println("[Main] Setup complete!");
    Serial.println("================================================");
    Serial.println();
}

// =============================================================================
// Main Loop
// =============================================================================

void loop() {
    // Poll BLE provisioning (handles WiFi connection state machine)
    bleProvisioning.poll();

    // Handle cloud connection based on WiFi and hub config state
    if (bleProvisioning.isWiFiConnected() && hubConfigStore.hasHubConfig()) {
        // WiFi connected and hub configured - manage cloud connection
        // NOTE: BLE stays active until we add a physical button for pairing mode

        // Start cloud connection if offline (unless cloud was disabled via disconnect command)
        if (cloudClient.getState() == CloudState::OFFLINE && !cloudClient.isCloudDisabled()) {
            Serial.println("[Main] Starting cloud connection...");
            cloudClient.connect();
        }
    }

    // Always poll cloud client (handles state machine, reconnection, heartbeat)
    cloudClient.poll();

    // Poll Bambu MQTT client for printer connections (only when WiFi connected)
    if (bleProvisioning.isWiFiConnected()) {
        bambuMqtt.poll();
    }

    // Print status periodically (every 10 seconds)
    static unsigned long lastStatusPrint = 0;
    if (millis() - lastStatusPrint > 10000) {
        lastStatusPrint = millis();

        if (bleProvisioning.isWiFiConnected()) {
            Serial.printf("[Status] WiFi: Connected | SSID: %s | IP: %s | RSSI: %d dBm | Cloud: %s%s | Printers: %d/%d connected\n",
                          bleProvisioning.getConnectedSSID().c_str(),
                          bleProvisioning.getIPAddress().c_str(),
                          bleProvisioning.getRSSI(),
                          CloudClient::stateToString(cloudClient.getState()),
                          cloudClient.isCloudDisabled() ? " (DISABLED)" : "",
                          bambuMqtt.getConnectedCount(),
                          bambuMqtt.getConfiguredCount());
        } else {
            Serial.printf("[Status] WiFi: Not connected | State: %d\n",
                          static_cast<uint8_t>(bleProvisioning.getState()));
        }
    }

    // Small delay to prevent watchdog issues
    delay(10);
}
