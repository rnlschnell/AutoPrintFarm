#ifndef BLE_PROVISIONING_H
#define BLE_PROVISIONING_H

#include <Arduino.h>
#include <NimBLEDevice.h>
#include "WiFiManager.h"

// Forward declarations
class PrinterManager;
class TunnelConfigStore;
class TunnelClient;

// BLE UUIDs for WiFi provisioning service
#define PROV_SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CREDENTIALS_CHAR_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"  // Write JSON {"ssid":"...","password":"..."}
#define STATUS_CHAR_UUID         "beb5483e-36e1-4688-b7f5-ea07361b26ab"  // Read/Notify status

// Printer configuration characteristic UUIDs
#define PRINTER_CONFIG_CHAR_UUID "beb5483e-36e1-4688-b7f5-ea07361b26ac"  // Write printer config JSON
#define PRINTER_STATUS_CHAR_UUID "beb5483e-36e1-4688-b7f5-ea07361b26ad"  // Read/Notify printer status JSON

// Cloud configuration characteristic UUID - receives tenant/claim config from app
// Write JSON {"tenant_id":"...","claim_token":"...","api_url":"..."}
#define CLOUD_CONFIG_CHAR_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ae"

// Status codes
#define STATUS_IDLE         0x00
#define STATUS_CONNECTING   0x02
#define STATUS_CONNECTED    0x03
#define STATUS_FAILED       0x04

// Special credential values
#define CREDENTIALS_CLEAR   "{\"clear\":true}"

class BLEProvisioning {
public:
    BLEProvisioning(WiFiManager& wifiManager);

    // Initialize BLE and start advertising
    void begin(const char* deviceName = "AutoPrintFarm-Hub");

    // Stop BLE (to save power if needed)
    void stop();

    // Check if BLE is running
    bool isRunning() const { return _running; }

    // Check if a client is connected
    bool isClientConnected() const;

    // Update status characteristic and notify connected client
    void updateStatus(uint8_t status);

    // Set printer manager reference for printer configuration
    void setPrinterManager(PrinterManager* printerManager);

    // Set tunnel config store reference for cloud configuration
    void setTunnelConfigStore(TunnelConfigStore* tunnelConfigStore);

    // Set tunnel client reference for reconnection after cloud config
    void setTunnelClient(TunnelClient* tunnelClient);

    // Update printer status characteristic
    void updatePrinterStatus();

    // Poll for processing (call in loop)
    void poll();

private:
    WiFiManager& _wifiManager;
    PrinterManager* _printerManager;
    TunnelConfigStore* _tunnelConfigStore;
    TunnelClient* _tunnelClient;
    bool _running;

    NimBLEServer* _pServer;
    NimBLEService* _pService;
    NimBLECharacteristic* _pCredentialsChar;
    NimBLECharacteristic* _pStatusChar;
    NimBLECharacteristic* _pPrinterConfigChar;
    NimBLECharacteristic* _pPrinterStatusChar;
    NimBLECharacteristic* _pCloudConfigChar;

    String _pendingSSID;
    String _pendingPassword;
    bool _connectRequested;

    // Pending printer config action
    String _pendingPrinterAction;
    String _pendingPrinterConfig;
    bool _printerConfigRequested;

    // Pending cloud config
    String _pendingCloudConfig;
    bool _cloudConfigRequested;

    void performConnect();
    void processPrinterConfig();
    void processCloudConfig();

    // Callback classes
    class ServerCallbacks;
    class CredentialsCallbacks;
    class PrinterConfigCallbacks;
    class CloudConfigCallbacks;

    friend class ServerCallbacks;
    friend class CredentialsCallbacks;
    friend class PrinterConfigCallbacks;
    friend class CloudConfigCallbacks;
};

#endif // BLE_PROVISIONING_H
