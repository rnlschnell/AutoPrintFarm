#include <Arduino.h>
#include "config.h"
#include "provisioning/CredentialStore.h"
#include "provisioning/HubConfigStore.h"
#include "provisioning/BLEProvisioning.h"
#include "cloud/CloudClient.h"

// =============================================================================
// Global Objects
// =============================================================================

CredentialStore credentialStore;
HubConfigStore hubConfigStore;
BLEProvisioning bleProvisioning(credentialStore, hubConfigStore);
CloudClient cloudClient(hubConfigStore);

// Track if BLE was stopped after WiFi connect
// NOTE: Currently always keeping BLE active until we add a physical button for pairing mode
bool bleStoppedAfterConnect = false;

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

    // Print status periodically (every 10 seconds)
    static unsigned long lastStatusPrint = 0;
    if (millis() - lastStatusPrint > 10000) {
        lastStatusPrint = millis();

        if (bleProvisioning.isWiFiConnected()) {
            Serial.printf("[Status] WiFi: Connected | SSID: %s | IP: %s | RSSI: %d dBm | Cloud: %s%s\n",
                          bleProvisioning.getConnectedSSID().c_str(),
                          bleProvisioning.getIPAddress().c_str(),
                          bleProvisioning.getRSSI(),
                          CloudClient::stateToString(cloudClient.getState()),
                          cloudClient.isCloudDisabled() ? " (DISABLED)" : "");
        } else {
            Serial.printf("[Status] WiFi: Not connected | State: %d\n",
                          static_cast<uint8_t>(bleProvisioning.getState()));
        }
    }

    // Small delay to prevent watchdog issues
    delay(10);
}
