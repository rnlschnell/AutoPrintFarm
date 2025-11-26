#include <Arduino.h>
#include "config.h"
#include "provisioning/CredentialStore.h"
#include "provisioning/WiFiManager.h"
#include "provisioning/BLEProvisioning.h"
#include "provisioning/PrinterConfigStore.h"
#include "PrinterManager.h"
#include "tunnel/TunnelConfigStore.h"
#include "tunnel/TunnelClient.h"

// Global instances
CredentialStore credentialStore;
WiFiManager wifiManager(credentialStore);
BLEProvisioning bleProvisioning(wifiManager);
PrinterConfigStore printerConfigStore;
PrinterManager printerManager(printerConfigStore);
TunnelConfigStore tunnelConfigStore;
TunnelClient tunnelClient(tunnelConfigStore, printerManager);

// State tracking
bool wifiConnected = false;
bool printersInitialized = false;
bool tunnelInitialized = false;

void initializePrinters() {
    if (printersInitialized) return;

    DEBUG_PRINTLN("[Main] Initializing printer connections...");

    // Load configured printers from NVS
    printerManager.loadPrinters();

    if (printerManager.getActiveCount() > 0) {
        DEBUG_PRINTF("[Main] Found %d configured printer(s)\n", printerManager.getActiveCount());

        // Connect to all configured printers
        printerManager.connectAll();
    } else {
        DEBUG_PRINTLN("[Main] No printers configured yet.");
        DEBUG_PRINTLN("[Main] Printers will be added via the cloud dashboard.");
    }

    printersInitialized = true;
}

void initializeTunnel() {
    if (tunnelInitialized) return;

    DEBUG_PRINTLN("[Main] Initializing cloud tunnel...");
    DEBUG_PRINTF("[Main] Hub ID: %s\n", tunnelConfigStore.getHubId().c_str());
    DEBUG_PRINTF("[Main] Cloud URL: %s\n", tunnelConfigStore.getCloudUrl().c_str());

    // Connect to cloud
    if (tunnelClient.connect()) {
        DEBUG_PRINTLN("[Main] Cloud tunnel connection initiated");
    } else {
        DEBUG_PRINTLN("[Main] Cloud tunnel connection failed - will retry");
    }

    tunnelInitialized = true;
}

void onWiFiStateChange(WiFiState newState) {
    switch (newState) {
        case WiFiState::CONNECTED:
            DEBUG_PRINTLN("[Main] WiFi connected!");
            DEBUG_PRINTF("[Main] IP Address: %s\n", wifiManager.getIPAddress().c_str());
            wifiConnected = true;

            // Initialize printers now that WiFi is available
            initializePrinters();

            // Initialize cloud tunnel
            initializeTunnel();
            break;

        case WiFiState::DISCONNECTED:
            DEBUG_PRINTLN("[Main] WiFi disconnected");
            wifiConnected = false;

            // Disconnect tunnel when WiFi drops
            tunnelClient.disconnect();
            tunnelInitialized = false;

            // Disconnect printers when WiFi drops
            if (printersInitialized) {
                printerManager.disconnectAll();
            }
            break;

        case WiFiState::CONNECTING:
            DEBUG_PRINTLN("[Main] WiFi connecting...");
            break;

        case WiFiState::FAILED:
            DEBUG_PRINTLN("[Main] WiFi connection failed");
            wifiConnected = false;
            break;
    }
}

void setup() {
    // Initialize serial
    Serial.begin(SERIAL_BAUD_RATE);
    delay(2000);  // Give time for USB CDC to connect

    Serial.println();
    Serial.println("========================================");
    Serial.println("   AutoPrintFarm-Hub Starting...");
    Serial.println("========================================");
    Serial.println();

    // Initialize NVS storage FIRST - critical for first boot after flash
    // This ensures the NVS partition is properly initialized before any read/write
    DEBUG_PRINTLN("[Main] Initializing NVS storage...");
    if (!credentialStore.begin()) {
        DEBUG_PRINTLN("[Main] WARNING: CredentialStore NVS init failed!");
    }
    if (!printerConfigStore.begin()) {
        DEBUG_PRINTLN("[Main] WARNING: PrinterConfigStore NVS init failed!");
    }
    if (!tunnelConfigStore.begin()) {
        DEBUG_PRINTLN("[Main] WARNING: TunnelConfigStore NVS init failed!");
    }

    // IMPORTANT: Start BLE FIRST before WiFi for proper coexistence
    // NimBLE must initialize the Bluetooth controller before WiFi takes over the radio
    DEBUG_PRINTLN("[Main] Starting BLE provisioning...");
    bleProvisioning.begin(DEVICE_NAME);

    // Give BLE time to fully initialize and start advertising
    delay(500);
    DEBUG_PRINTF("[Main] BLE running: %s\n", bleProvisioning.isRunning() ? "YES" : "NO");

    // Initialize PrinterManager
    printerManager.begin();

    // Initialize TunnelClient
    tunnelClient.begin();

    // Link BLE provisioning to PrinterManager for printer configuration via BLE
    // Note: With cloud architecture, printers are primarily configured via cloud
    bleProvisioning.setPrinterManager(&printerManager);

    // Link BLE provisioning to TunnelConfigStore and TunnelClient for cloud configuration via BLE
    bleProvisioning.setTunnelConfigStore(&tunnelConfigStore);
    bleProvisioning.setTunnelClient(&tunnelClient);

    // Initialize WiFi manager after BLE is running
    wifiManager.begin();
    wifiManager.setStateChangeCallback(onWiFiStateChange);

    // Check for stored credentials and attempt connection
    if (credentialStore.hasCredentials()) {
        DEBUG_PRINTF("[Main] Found stored credentials for: %s\n",
                     credentialStore.getStoredSSID().c_str());
        DEBUG_PRINTLN("[Main] Attempting WiFi connection...");

        if (wifiManager.connectWithStoredCredentials()) {
            DEBUG_PRINTLN("[Main] WiFi connected successfully!");
        } else {
            DEBUG_PRINTLN("[Main] WiFi connection failed. Use BLE to reconfigure.");
        }
    } else {
        DEBUG_PRINTLN("[Main] No stored WiFi credentials.");
        DEBUG_PRINTLN("[Main] Use BLE to configure WiFi:");
        DEBUG_PRINTF("[Main] - Device name: %s\n", DEVICE_NAME);
        DEBUG_PRINTLN("[Main] - Connect via Web Bluetooth in Chrome/Edge");
    }

    DEBUG_PRINTLN();
    DEBUG_PRINTLN("[Main] Setup complete!");
    DEBUG_PRINTLN("========================================");
    DEBUG_PRINTLN();
}

void loop() {
    // Poll WiFi manager for state changes
    wifiManager.poll();

    // Poll BLE provisioning for incoming commands
    bleProvisioning.poll();

    // Poll when WiFi is connected
    if (wifiConnected) {
        // Poll printer manager
        if (printersInitialized) {
            printerManager.poll();
        }

        // Poll cloud tunnel
        if (tunnelInitialized) {
            tunnelClient.poll();
        }
    }

    // Small delay to prevent watchdog issues
    delay(10);
}
