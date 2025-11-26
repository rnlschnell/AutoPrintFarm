#ifndef TUNNEL_CLIENT_H
#define TUNNEL_CLIENT_H

#include <Arduino.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include "../PrinterManager.h"
#include "TunnelConfigStore.h"
#include "TunnelMessages.h"

// =============================================================================
// Tunnel State Machine
// =============================================================================

enum class TunnelState {
    OFFLINE,        // WiFi not connected or tunnel disabled
    REGISTERING,    // Calling hub registration API before WebSocket connect
    CONNECTING,     // Attempting WebSocket connection
    AUTHENTICATING, // WebSocket open, sending hub_hello, waiting for hub_welcome
    CONNECTED,      // Authenticated and operational
    RECONNECTING,   // Connection lost, attempting reconnect with backoff
    FAILED          // Permanent failure (exhausted retries)
};

/**
 * Manages WebSocket connection to cloud backend.
 *
 * Responsibilities:
 * - Establish and maintain WebSocket connection to cloud
 * - Send hub_hello on connect, handle hub_welcome
 * - Forward printer status updates to cloud
 * - Receive and execute commands from cloud
 * - Auto-reconnect with exponential backoff
 * - Periodic heartbeat via ping/pong
 */
class TunnelClient {
public:
    /**
     * Construct TunnelClient.
     * @param configStore Reference to tunnel config storage
     * @param printerManager Reference to printer manager for operations
     */
    TunnelClient(TunnelConfigStore& configStore, PrinterManager& printerManager);

    ~TunnelClient();

    /**
     * Initialize the tunnel client. Sets up WebSocket callbacks.
     */
    void begin();

    /**
     * Attempt to connect to the cloud.
     * @return true if connection initiated successfully
     */
    bool connect();

    /**
     * Disconnect from the cloud.
     */
    void disconnect();

    /**
     * Check if connected and authenticated.
     */
    bool isConnected() const { return _state == TunnelState::CONNECTED; }

    /**
     * Get current tunnel state.
     */
    TunnelState getState() const { return _state; }

    /**
     * Get state as human-readable string.
     */
    static const char* stateToString(TunnelState state);

    /**
     * Must be called frequently in main loop.
     * Handles WebSocket polling, reconnection, heartbeat.
     */
    void poll();

    /**
     * Send printer status update to cloud.
     * @param printerId Printer serial number
     * @param status Current printer status
     */
    void sendPrinterStatus(const String& printerId, const PrinterStatus& status);

    /**
     * Send file transfer progress update.
     * @param printerId Printer serial number
     * @param jobId Job ID
     * @param stage Transfer stage (downloading/uploading/complete/failed)
     * @param progress Progress percentage (0-100)
     * @param error Error message if failed
     */
    void sendFileProgress(const String& printerId, const String& jobId,
                          const char* stage, int progress, const String& error = "");

    /**
     * Set callback for when tunnel state changes.
     */
    typedef void (*StateChangeCallback)(TunnelState newState);
    void setStateChangeCallback(StateChangeCallback callback) { _stateCallback = callback; }

private:
    TunnelConfigStore& _configStore;
    PrinterManager& _printerManager;
    websockets::WebsocketsClient _wsClient;

    // State
    TunnelState _state = TunnelState::OFFLINE;
    StateChangeCallback _stateCallback = nullptr;

    // Timing
    unsigned long _lastPingTime = 0;
    unsigned long _lastPongTime = 0;
    unsigned long _lastReconnectAttempt = 0;
    unsigned long _lastStatusBroadcast = 0;
    unsigned long _authStartTime = 0;

    // Reconnection backoff
    uint8_t _reconnectAttempts = 0;

    // State management
    void setState(TunnelState newState);

    // Connection
    String buildWebSocketUrl();
    void onConnect();
    void onDisconnect();

    // Message handlers
    void onMessage(websockets::WebsocketsMessage message);
    void handleHubWelcome(JsonDocument& doc);
    void handleConfigurePrinter(JsonDocument& doc);
    void handlePrinterCommand(JsonDocument& doc);
    void handlePrintCommand(JsonDocument& doc);
    void handleDiscoverPrinters(JsonDocument& doc);
    void handleError(JsonDocument& doc);

    // Outgoing messages
    void sendHubHello();
    void sendCommandAck(const String& commandId, bool success, const String& error = "");
    void sendMessage(const String& json);

    // Heartbeat
    void handleHeartbeat();

    // Reconnection
    unsigned long getReconnectDelay() const;
    void attemptReconnect();

    // Registration
    bool registerWithCloud();
    String buildRegistrationUrl();

    // Periodic status broadcast
    void broadcastAllPrinterStatus();

    // Helper to convert PrinterState to cloud status string
    static const char* printerStateToCloudStatus(PrinterState state);

    // Helper to find printer by serial number
    int8_t findPrinterBySerial(const String& serial);
};

#endif // TUNNEL_CLIENT_H
