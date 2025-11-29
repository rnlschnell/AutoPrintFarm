#ifndef BLE_PROVISIONING_H
#define BLE_PROVISIONING_H

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <WiFi.h>
#include "CredentialStore.h"
#include "HubConfigStore.h"

/**
 * WiFi provisioning states
 */
enum class ProvisioningState : uint8_t {
    IDLE           = 0x00,  // Not connected, no operation in progress
    CONNECTING     = 0x01,  // WiFi connection in progress
    CONNECTED      = 0x02,  // Successfully connected to WiFi
    FAILED         = 0x03,  // Connection failed
    DISCONNECTED   = 0x04,  // Explicitly disconnected
    NO_CREDENTIALS = 0x05   // No SSID/password stored
};

/**
 * BLEProvisioning - BLE-based WiFi provisioning service
 *
 * Exposes a BLE GATT service that allows a web browser (via Web Bluetooth)
 * to configure WiFi credentials on the ESP32.
 */
class BLEProvisioning : public NimBLEServerCallbacks,
                        public NimBLECharacteristicCallbacks {
public:
    /**
     * Constructor
     * @param credentialStore Reference to credential storage
     * @param hubConfigStore Reference to hub config storage
     */
    BLEProvisioning(CredentialStore& credentialStore, HubConfigStore& hubConfigStore);

    /**
     * Initialize BLE and start advertising
     * @param deviceName Name shown in BLE scan (default: "AutoPrintFarm Hub")
     */
    void begin(const char* deviceName = "AutoPrintFarm Hub");

    /**
     * Stop BLE advertising and deinit
     */
    void stop();

    /**
     * Stop BLE advertising only (keeps BLE stack running)
     * Call this after WiFi is connected to save power
     */
    void stopAdvertising();

    /**
     * Restart BLE advertising
     * Call this if WiFi is lost and re-provisioning is needed
     */
    void restartAdvertising();

    /**
     * Must be called in main loop - handles WiFi connection state machine
     */
    void poll();

    /**
     * Get current provisioning state
     */
    ProvisioningState getState() const { return _state; }

    /**
     * Check if WiFi is connected
     */
    bool isWiFiConnected() const;

    /**
     * Get connected WiFi SSID
     */
    String getConnectedSSID() const;

    /**
     * Get IP address (empty string if not connected)
     */
    String getIPAddress() const;

    /**
     * Get WiFi signal strength
     */
    int getRSSI() const;

    /**
     * Attempt auto-connect with stored credentials
     * Called on boot if credentials exist
     */
    void autoConnect();

    // NimBLEServerCallbacks (NimBLE 1.4.x signatures)
    void onConnect(NimBLEServer* pServer) override;
    void onDisconnect(NimBLEServer* pServer) override;

    // NimBLECharacteristicCallbacks (NimBLE 1.4.x signatures)
    void onWrite(NimBLECharacteristic* pCharacteristic) override;
    void onRead(NimBLECharacteristic* pCharacteristic) override;

private:
    CredentialStore& _credentialStore;
    HubConfigStore& _hubConfigStore;

    // BLE objects
    NimBLEServer* _pServer;
    NimBLEService* _pService;
    NimBLECharacteristic* _pSsidChar;
    NimBLECharacteristic* _pPasswordChar;
    NimBLECharacteristic* _pCommandChar;
    NimBLECharacteristic* _pStatusChar;
    NimBLECharacteristic* _pHubIdChar;
    NimBLECharacteristic* _pTenantIdChar;

    // State
    ProvisioningState _state;
    bool _bleClientConnected;
    bool _bleInitialized;

    // Pending credentials (received via BLE, not yet saved)
    String _pendingSsid;
    String _pendingPassword;

    // Pending hub config (received via BLE, saved on CMD_CONNECT)
    String _pendingHubId;
    String _pendingTenantId;

    // WiFi connection timing
    unsigned long _wifiConnectStartTime;
    bool _wifiConnecting;

    // BLE reconnection handling
    bool _needsAdvertisingRestart;
    unsigned long _disconnectTime;

    // Internal methods
    void setupBLE(const char* deviceName);
    void startAdvertising();
    void handleCommand(uint8_t cmd);
    void connectToWiFi();
    void disconnectWiFi();
    void updateState(ProvisioningState newState);
    void notifyStatus();
};

#endif // BLE_PROVISIONING_H
