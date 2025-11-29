#ifndef CLOUD_CLIENT_H
#define CLOUD_CLIENT_H

#include <Arduino.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include "../provisioning/HubConfigStore.h"
#include "../printers/BambuMqttClient.h"

// =============================================================================
// CloudClient State Machine
// =============================================================================

enum class CloudState {
    OFFLINE,        // WiFi not connected or not initialized
    CONNECTING,     // Attempting WebSocket connection
    AUTHENTICATING, // Connected, waiting for hub_welcome after sending hub_hello
    CONNECTED,      // Authenticated and operational
    RECONNECTING,   // Connection lost, backing off before retry
    FAILED          // Exhausted retries (requires manual intervention)
};

// =============================================================================
// CloudClient Class
// =============================================================================

class CloudClient {
public:
    /**
     * Constructor
     * @param hubConfigStore Reference to hub configuration store for hub_id
     */
    CloudClient(HubConfigStore& hubConfigStore);

    /**
     * Initialize the CloudClient (set up callbacks)
     * Call this once in setup()
     */
    void begin();

    /**
     * Start connection to cloud
     * Call this when WiFi is connected and hub is configured
     */
    void connect();

    /**
     * Disconnect from cloud
     * Call this to cleanly disconnect
     */
    void disconnect();

    /**
     * Poll the client (must be called in main loop)
     * Handles state machine, reconnection, and heartbeat
     */
    void poll();

    /**
     * Check if connected and authenticated
     */
    bool isConnected() const;

    /**
     * Check if cloud is disabled (via disconnect command)
     */
    bool isCloudDisabled() const;

    /**
     * Get current state
     */
    CloudState getState() const;

    /**
     * Convert state to string for logging
     */
    static const char* stateToString(CloudState state);

    // =========================================================================
    // Printer Integration
    // =========================================================================

    /**
     * Set the MQTT client for printer communication
     * @param mqttClient Pointer to BambuMqttClient instance
     */
    void setMqttClient(BambuMqttClient* mqttClient);

    /**
     * Send printer status to cloud
     * Called by the MQTT client callback when printer status is received
     */
    void sendPrinterStatus(const PrinterStatus& status);

private:
    HubConfigStore& _hubConfigStore;
    websockets::WebsocketsClient _wsClient;
    BambuMqttClient* _mqttClient;

    // State machine
    CloudState _state;

    // Timing
    unsigned long _lastActivityTime;      // Last message sent/received
    unsigned long _lastPingTime;          // Last ping sent
    unsigned long _lastReconnectAttempt;  // Last reconnection attempt
    unsigned long _authStartTime;         // When authentication started
    unsigned long _failedStateStartTime;  // When FAILED state was entered

    // Reconnection
    uint8_t _reconnectAttempts;

    // Cloud disabled flag (set by disconnect command, prevents reconnection)
    bool _cloudDisabled;

    // =========================================================================
    // Internal methods
    // =========================================================================

    /**
     * Build the WebSocket URL from hub config
     */
    String buildWebSocketUrl();

    /**
     * Handle WebSocket connection established
     */
    void onConnect();

    /**
     * Handle WebSocket disconnection
     */
    void onDisconnect();

    /**
     * Handle incoming WebSocket message
     */
    void onMessage(websockets::WebsocketsMessage message);

    /**
     * Handle WebSocket events (connect, disconnect, error)
     */
    void onEvent(websockets::WebsocketsEvent event, String data);

    // Message handlers
    void handleHubWelcome(JsonDocument& doc);
    void handleHubConfig(JsonDocument& doc);
    void handleConfigurePrinter(JsonDocument& doc);
    void handlePrinterCommand(JsonDocument& doc);
    void handlePrintCommand(JsonDocument& doc);
    void handleDiscoverPrinters(JsonDocument& doc);
    void handleHubCommand(JsonDocument& doc);
    void handleError(JsonDocument& doc);

    // Outgoing messages
    void sendHubHello();
    void sendMessage(const String& json);
    void sendCommandAck(const char* commandId, bool success, const String& error = "");

    // Reconnection logic
    unsigned long getReconnectDelay() const;
    void attemptReconnect();
    void transitionTo(CloudState newState);

    // Heartbeat
    void handleHeartbeat();
};

#endif // CLOUD_CLIENT_H
