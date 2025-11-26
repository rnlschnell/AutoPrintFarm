#include "TunnelClient.h"
#include "../config.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

using namespace websockets;

// =============================================================================
// Constructor / Destructor
// =============================================================================

TunnelClient::TunnelClient(TunnelConfigStore& configStore, PrinterManager& printerManager)
    : _configStore(configStore), _printerManager(printerManager) {
    // Initialize printer array slots to nullptr
    for (int i = 0; i < MAX_PRINTERS; i++) {
        // Initialization handled by PrinterManager
    }
}

TunnelClient::~TunnelClient() {
    disconnect();
}

// =============================================================================
// Initialization
// =============================================================================

void TunnelClient::begin() {
    DEBUG_PRINTLN("[Tunnel] Initializing...");

    // Set up WebSocket callbacks using lambdas
    _wsClient.onMessage([this](WebsocketsMessage message) {
        this->onMessage(message);
    });

    _wsClient.onEvent([this](WebsocketsEvent event, String data) {
        switch (event) {
            case WebsocketsEvent::ConnectionOpened:
                this->onConnect();
                break;
            case WebsocketsEvent::ConnectionClosed:
                this->onDisconnect();
                break;
            case WebsocketsEvent::GotPing:
                DEBUG_PRINTLN("[Tunnel] Received ping");
                break;
            case WebsocketsEvent::GotPong:
                this->_lastPongTime = millis();
                DEBUG_PRINTLN("[Tunnel] Received pong");
                break;
            default:
                break;
        }
    });

    DEBUG_PRINTLN("[Tunnel] Initialization complete");
}

// =============================================================================
// Connection Management
// =============================================================================

bool TunnelClient::connect() {
    if (_state == TunnelState::CONNECTING || _state == TunnelState::CONNECTED ||
        _state == TunnelState::REGISTERING) {
        DEBUG_PRINTLN("[Tunnel] Already connecting, registering, or connected");
        return true;
    }

    if (WiFi.status() != WL_CONNECTED) {
        DEBUG_PRINTLN("[Tunnel] Cannot connect - WiFi not connected");
        setState(TunnelState::OFFLINE);
        return false;
    }

    // Check if we need to register with the cloud first
    if (!_configStore.isRegistered()) {
        DEBUG_PRINTLN("[Tunnel] Hub not registered, registering first...");
        setState(TunnelState::REGISTERING);

        if (!registerWithCloud()) {
            DEBUG_PRINTLN("[Tunnel] Registration failed");
            setState(TunnelState::RECONNECTING);
            _lastReconnectAttempt = millis();
            return false;
        }

        DEBUG_PRINTLN("[Tunnel] Registration successful, proceeding to connect...");
    }

    String url = buildWebSocketUrl();
    DEBUG_PRINTF("[Tunnel] Connecting to: %s\n", url.c_str());

    setState(TunnelState::CONNECTING);

    // For TLS connections (wss://), skip certificate verification
    // Similar to BambuClient approach
    if (url.startsWith("wss://")) {
        _wsClient.setInsecure();
    }

    bool connected = _wsClient.connect(url);

    if (!connected) {
        DEBUG_PRINTLN("[Tunnel] WebSocket connection failed");
        setState(TunnelState::RECONNECTING);
        _lastReconnectAttempt = millis();
        return false;
    }

    // Connection succeeded, onConnect() will be called via callback
    return true;
}

void TunnelClient::disconnect() {
    if (_state == TunnelState::OFFLINE) {
        return;
    }

    DEBUG_PRINTLN("[Tunnel] Disconnecting...");
    _wsClient.close();
    setState(TunnelState::OFFLINE);
    _reconnectAttempts = 0;
}

String TunnelClient::buildWebSocketUrl() {
    String baseUrl = _configStore.getCloudUrl();
    String hubId = _configStore.getHubId();

    // Build URL: {baseUrl}/ws/hub/{hubId}
    String url = baseUrl;

    // Ensure no trailing slash on base URL
    if (url.endsWith("/")) {
        url = url.substring(0, url.length() - 1);
    }

    url += "/ws/hub/";
    url += hubId;

    return url;
}

// =============================================================================
// Connection Event Handlers
// =============================================================================

void TunnelClient::onConnect() {
    DEBUG_PRINTLN("[Tunnel] WebSocket connected");
    setState(TunnelState::AUTHENTICATING);
    _authStartTime = millis();
    _lastPongTime = millis();

    // Send hub_hello to authenticate
    sendHubHello();
}

void TunnelClient::onDisconnect() {
    DEBUG_PRINTLN("[Tunnel] WebSocket disconnected");

    if (_state == TunnelState::CONNECTED || _state == TunnelState::AUTHENTICATING) {
        // Unexpected disconnect - try to reconnect
        setState(TunnelState::RECONNECTING);
        _lastReconnectAttempt = millis();
    } else {
        setState(TunnelState::OFFLINE);
    }
}

// =============================================================================
// Message Handling
// =============================================================================

void TunnelClient::onMessage(WebsocketsMessage message) {
    if (!message.isText()) {
        DEBUG_PRINTLN("[Tunnel] Received non-text message, ignoring");
        return;
    }

    String payload = message.data();
    DEBUG_PRINTF("[Tunnel] Received: %s\n", payload.c_str());

    // Parse JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        DEBUG_PRINTF("[Tunnel] JSON parse error: %s\n", error.c_str());
        return;
    }

    // Get message type
    const char* type = doc["type"];
    if (!type) {
        DEBUG_PRINTLN("[Tunnel] Message missing 'type' field");
        return;
    }

    // Route to appropriate handler
    if (strcmp(type, CloudMessages::HUB_WELCOME) == 0) {
        handleHubWelcome(doc);
    } else if (strcmp(type, CloudMessages::CONFIGURE_PRINTER) == 0) {
        handleConfigurePrinter(doc);
    } else if (strcmp(type, CloudMessages::PRINTER_COMMAND) == 0) {
        handlePrinterCommand(doc);
    } else if (strcmp(type, CloudMessages::PRINT_COMMAND) == 0) {
        handlePrintCommand(doc);
    } else if (strcmp(type, CloudMessages::DISCOVER_PRINTERS) == 0) {
        handleDiscoverPrinters(doc);
    } else if (strcmp(type, CloudMessages::ERROR) == 0) {
        handleError(doc);
    } else {
        DEBUG_PRINTF("[Tunnel] Unknown message type: %s\n", type);
    }
}

void TunnelClient::handleHubWelcome(JsonDocument& doc) {
    DEBUG_PRINTLN("[Tunnel] Received hub_welcome - authenticated!");

    const char* hubId = doc["hub_id"];
    if (hubId) {
        DEBUG_PRINTF("[Tunnel] Hub ID confirmed: %s\n", hubId);
    }

    setState(TunnelState::CONNECTED);
    _reconnectAttempts = 0;
    _lastPingTime = millis();
    _lastStatusBroadcast = 0;  // Trigger immediate status broadcast

    // Broadcast all printer statuses after connection
    broadcastAllPrinterStatus();
}

void TunnelClient::handleConfigurePrinter(JsonDocument& doc) {
    const char* commandId = doc["command_id"];
    const char* action = doc["action"];

    if (!commandId || !action) {
        DEBUG_PRINTLN("[Tunnel] configure_printer missing required fields");
        return;
    }

    JsonObject printer = doc["printer"];
    if (printer.isNull()) {
        sendCommandAck(commandId, false, "Missing printer object");
        return;
    }

    const char* printerId = printer["id"];
    const char* serialNumber = printer["serial_number"];
    const char* connectionType = printer["connection_type"];

    DEBUG_PRINTF("[Tunnel] configure_printer: action=%s, serial=%s\n",
                 action, serialNumber ? serialNumber : "null");

    bool success = false;
    String errorMsg;

    if (strcmp(action, ConfigureActions::ADD) == 0) {
        // Add a new printer
        const char* accessCode = printer["access_code"];
        const char* ipAddress = printer["ip_address"];

        if (!serialNumber || !connectionType) {
            sendCommandAck(commandId, false, "Missing serial_number or connection_type");
            return;
        }

        // Build PrinterConfig
        PrinterConfig config;
        config.id = printerId ? String(printerId) : "";
        config.type = connectionType ? String(connectionType) : "bambu";
        config.name = serialNumber;  // Use serial as name for now
        config.serial = serialNumber ? String(serialNumber) : "";
        config.accessCode = accessCode ? String(accessCode) : "";
        config.ip = ipAddress ? String(ipAddress) : "";
        config.port = BAMBU_MQTT_PORT;

        int8_t slot = _printerManager.addPrinter(config);
        if (slot >= 0) {
            success = true;
            DEBUG_PRINTF("[Tunnel] Printer added to slot %d\n", slot);
        } else {
            errorMsg = "Failed to add printer - no free slots";
        }

    } else if (strcmp(action, ConfigureActions::REMOVE) == 0) {
        // Remove a printer by serial
        if (!serialNumber) {
            sendCommandAck(commandId, false, "Missing serial_number");
            return;
        }

        int8_t slot = findPrinterBySerial(serialNumber);
        if (slot >= 0) {
            _printerManager.removePrinter(slot);
            success = true;
            DEBUG_PRINTF("[Tunnel] Printer removed from slot %d\n", slot);
        } else {
            errorMsg = "Printer not found";
        }

    } else if (strcmp(action, ConfigureActions::UPDATE) == 0) {
        // Update printer configuration
        if (!serialNumber) {
            sendCommandAck(commandId, false, "Missing serial_number");
            return;
        }

        int8_t slot = findPrinterBySerial(serialNumber);
        if (slot >= 0) {
            // For now, remove and re-add
            // TODO: Implement proper update without disconnect
            _printerManager.removePrinter(slot);

            const char* accessCode = printer["access_code"];
            const char* ipAddress = printer["ip_address"];

            PrinterConfig config;
            config.id = printerId ? String(printerId) : "";
            config.type = connectionType ? String(connectionType) : "bambu";
            config.name = serialNumber;
            config.serial = serialNumber ? String(serialNumber) : "";
            config.accessCode = accessCode ? String(accessCode) : "";
            config.ip = ipAddress ? String(ipAddress) : "";
            config.port = BAMBU_MQTT_PORT;

            int8_t newSlot = _printerManager.addPrinter(config);
            success = (newSlot >= 0);
            if (!success) {
                errorMsg = "Failed to re-add printer after update";
            }
        } else {
            errorMsg = "Printer not found";
        }

    } else {
        errorMsg = "Unknown action: " + String(action);
    }

    sendCommandAck(commandId, success, errorMsg);
}

void TunnelClient::handlePrinterCommand(JsonDocument& doc) {
    const char* commandId = doc["command_id"];
    const char* printerId = doc["printer_id"];
    const char* action = doc["action"];

    if (!commandId || !printerId || !action) {
        DEBUG_PRINTLN("[Tunnel] printer_command missing required fields");
        return;
    }

    DEBUG_PRINTF("[Tunnel] printer_command: printer=%s, action=%s\n", printerId, action);

    // Find printer by serial number (printer_id from cloud is serial)
    int8_t slot = findPrinterBySerial(printerId);
    if (slot < 0) {
        sendCommandAck(commandId, false, "Printer not found");
        return;
    }

    PrinterClient* printer = _printerManager.getPrinter(slot);
    if (!printer || !printer->isConnected()) {
        sendCommandAck(commandId, false, "Printer not connected");
        return;
    }

    bool success = false;
    String errorMsg;

    if (strcmp(action, PrinterActions::PAUSE) == 0) {
        success = printer->pause();
        if (!success) errorMsg = "Pause command failed";
    } else if (strcmp(action, PrinterActions::RESUME) == 0) {
        success = printer->resume();
        if (!success) errorMsg = "Resume command failed";
    } else if (strcmp(action, PrinterActions::STOP) == 0) {
        success = printer->stop();
        if (!success) errorMsg = "Stop command failed";
    } else if (strcmp(action, PrinterActions::CLEAR_BED) == 0) {
        // clear_bed is typically just marking the bed as ready
        // Most printers don't have a specific command for this
        // For Bambu, this might send a gcode or just acknowledge
        success = true;  // Just acknowledge for now
        DEBUG_PRINTLN("[Tunnel] clear_bed acknowledged (no physical action)");
    } else {
        errorMsg = "Unknown action: " + String(action);
    }

    sendCommandAck(commandId, success, errorMsg);
}

void TunnelClient::handlePrintCommand(JsonDocument& doc) {
    const char* commandId = doc["command_id"];

    DEBUG_PRINTLN("[Tunnel] print_command received (not implemented yet)");

    // TODO: Implement file download from file_url, upload to printer, start print
    // This requires FTPS implementation for Bambu printers

    sendCommandAck(commandId, false, "print_command not yet implemented");
}

void TunnelClient::handleDiscoverPrinters(JsonDocument& doc) {
    const char* commandId = doc["command_id"];

    DEBUG_PRINTLN("[Tunnel] discover_printers received (not implemented yet)");

    // TODO: Implement mDNS/network scanning for Bambu printers
    // For now, just acknowledge with empty list

    sendCommandAck(commandId, false, "discover_printers not yet implemented");
}

void TunnelClient::handleError(JsonDocument& doc) {
    const char* error = doc["error"];
    DEBUG_PRINTF("[Tunnel] Cloud error: %s\n", error ? error : "unknown");
}

// =============================================================================
// Outgoing Messages
// =============================================================================

void TunnelClient::sendHubHello() {
    JsonDocument doc;

    doc["type"] = HubMessages::HUB_HELLO;
    doc["hub_id"] = _configStore.getHubId();
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["hardware_version"] = "ESP32-S3-N16R8";
    doc["mac_address"] = _configStore.getMacAddress();

    String json;
    serializeJson(doc, json);

    DEBUG_PRINTF("[Tunnel] Sending hub_hello: %s\n", json.c_str());
    sendMessage(json);
}

void TunnelClient::sendCommandAck(const String& commandId, bool success, const String& error) {
    JsonDocument doc;

    doc["type"] = HubMessages::COMMAND_ACK;
    doc["command_id"] = commandId;
    doc["success"] = success;

    if (!success && error.length() > 0) {
        doc["error"] = error;
    }

    String json;
    serializeJson(doc, json);

    DEBUG_PRINTF("[Tunnel] Sending command_ack: %s\n", json.c_str());
    sendMessage(json);
}

void TunnelClient::sendPrinterStatus(const String& printerId, const PrinterStatus& status) {
    if (_state != TunnelState::CONNECTED) {
        return;
    }

    JsonDocument doc;

    doc["type"] = HubMessages::PRINTER_STATUS;
    doc["printer_id"] = printerId;
    doc["status"] = printerStateToCloudStatus(status.state);

    if (status.progressPercent > 0) {
        doc["progress_percentage"] = (int)status.progressPercent;
    }
    if (status.remainingSeconds > 0) {
        doc["remaining_time_seconds"] = status.remainingSeconds;
    }
    if (status.currentLayer > 0) {
        doc["current_layer"] = status.currentLayer;
    }
    if (status.totalLayers > 0) {
        doc["total_layers"] = status.totalLayers;
    }

    // Temperatures
    JsonObject temps = doc["temperatures"].to<JsonObject>();
    temps["nozzle"] = status.nozzleTemp;
    temps["bed"] = status.bedTemp;

    if (status.errorMessage.length() > 0) {
        doc["error_message"] = status.errorMessage;
    }

    String json;
    serializeJson(doc, json);

    sendMessage(json);
}

void TunnelClient::sendFileProgress(const String& printerId, const String& jobId,
                                     const char* stage, int progress, const String& error) {
    if (_state != TunnelState::CONNECTED) {
        return;
    }

    JsonDocument doc;

    doc["type"] = HubMessages::FILE_PROGRESS;
    doc["printer_id"] = printerId;
    doc["job_id"] = jobId;
    doc["stage"] = stage;
    doc["progress_percentage"] = progress;

    if (error.length() > 0) {
        doc["error"] = error;
    }

    String json;
    serializeJson(doc, json);

    sendMessage(json);
}

void TunnelClient::sendMessage(const String& json) {
    if (!_wsClient.available()) {
        DEBUG_PRINTLN("[Tunnel] Cannot send - WebSocket not available");
        return;
    }

    _wsClient.send(json);
}

// =============================================================================
// Polling and State Management
// =============================================================================

void TunnelClient::poll() {
    // Check WiFi status
    if (WiFi.status() != WL_CONNECTED) {
        if (_state != TunnelState::OFFLINE) {
            DEBUG_PRINTLN("[Tunnel] WiFi disconnected");
            _wsClient.close();
            setState(TunnelState::OFFLINE);
        }
        return;
    }

    switch (_state) {
        case TunnelState::OFFLINE:
            // Do nothing, wait for connect() call
            break;

        case TunnelState::CONNECTING:
            // Poll WebSocket for connection result
            _wsClient.poll();
            break;

        case TunnelState::AUTHENTICATING:
            // Poll for hub_welcome response
            _wsClient.poll();

            // Check for auth timeout
            if (millis() - _authStartTime > TUNNEL_AUTH_TIMEOUT_MS) {
                DEBUG_PRINTLN("[Tunnel] Authentication timeout");
                _wsClient.close();
                setState(TunnelState::RECONNECTING);
                _lastReconnectAttempt = millis();
            }
            break;

        case TunnelState::CONNECTED:
            // Poll for messages
            _wsClient.poll();

            // Handle heartbeat
            handleHeartbeat();

            // Periodic status broadcast
            if (millis() - _lastStatusBroadcast >= TUNNEL_STATUS_BROADCAST_MS) {
                _lastStatusBroadcast = millis();
                broadcastAllPrinterStatus();
            }
            break;

        case TunnelState::RECONNECTING:
            attemptReconnect();
            break;

        case TunnelState::FAILED:
            // Permanent failure - do nothing until reset
            break;
    }
}

void TunnelClient::handleHeartbeat() {
    unsigned long now = millis();

    // Send ping periodically
    if (now - _lastPingTime >= TUNNEL_PING_INTERVAL_MS) {
        _lastPingTime = now;
        _wsClient.ping();
        DEBUG_PRINTLN("[Tunnel] Sent ping");
    }

    // Check for pong timeout
    if (now - _lastPongTime > TUNNEL_PONG_TIMEOUT_MS) {
        DEBUG_PRINTLN("[Tunnel] Heartbeat timeout - no pong received");
        _wsClient.close();
        setState(TunnelState::RECONNECTING);
        _lastReconnectAttempt = millis();
    }
}

void TunnelClient::attemptReconnect() {
    unsigned long now = millis();
    unsigned long delay = getReconnectDelay();

    if (now - _lastReconnectAttempt < delay) {
        return;  // Wait for backoff delay
    }

    _reconnectAttempts++;
    _lastReconnectAttempt = now;

    DEBUG_PRINTF("[Tunnel] Reconnect attempt %d/%d (delay was %lums)\n",
                 _reconnectAttempts, TUNNEL_MAX_RECONNECT_ATTEMPTS, delay);

    if (_reconnectAttempts > TUNNEL_MAX_RECONNECT_ATTEMPTS) {
        DEBUG_PRINTLN("[Tunnel] Max reconnect attempts exceeded - entering FAILED state");
        setState(TunnelState::FAILED);
        return;
    }

    // Attempt to connect
    connect();
}

unsigned long TunnelClient::getReconnectDelay() const {
    // Exponential backoff: initial * 2^attempts, capped at max
    unsigned long delay = TUNNEL_RECONNECT_INITIAL_MS;

    for (uint8_t i = 0; i < _reconnectAttempts && i < 10; i++) {
        delay *= 2;
        if (delay > TUNNEL_RECONNECT_MAX_MS) {
            delay = TUNNEL_RECONNECT_MAX_MS;
            break;
        }
    }

    return delay;
}

void TunnelClient::setState(TunnelState newState) {
    if (_state != newState) {
        DEBUG_PRINTF("[Tunnel] State: %s -> %s\n",
                     stateToString(_state), stateToString(newState));
        _state = newState;

        if (_stateCallback) {
            _stateCallback(newState);
        }
    }
}

const char* TunnelClient::stateToString(TunnelState state) {
    switch (state) {
        case TunnelState::OFFLINE:        return "OFFLINE";
        case TunnelState::REGISTERING:    return "REGISTERING";
        case TunnelState::CONNECTING:     return "CONNECTING";
        case TunnelState::AUTHENTICATING: return "AUTHENTICATING";
        case TunnelState::CONNECTED:      return "CONNECTED";
        case TunnelState::RECONNECTING:   return "RECONNECTING";
        case TunnelState::FAILED:         return "FAILED";
        default:                          return "UNKNOWN";
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

void TunnelClient::broadcastAllPrinterStatus() {
    DEBUG_PRINTLN("[Tunnel] Broadcasting all printer statuses...");

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        PrinterClient* printer = _printerManager.getPrinter(i);
        if (printer) {
            PrinterStatus status = printer->getStatus();
            String printerId = printer->getPrinterId();

            if (printerId.length() > 0) {
                sendPrinterStatus(printerId, status);
            }
        }
    }
}

const char* TunnelClient::printerStateToCloudStatus(PrinterState state) {
    switch (state) {
        case PrinterState::IDLE:     return PrinterStatusStrings::IDLE;
        case PrinterState::PRINTING: return PrinterStatusStrings::PRINTING;
        case PrinterState::PAUSED:   return PrinterStatusStrings::PAUSED;
        case PrinterState::ERROR:    return PrinterStatusStrings::ERROR;
        case PrinterState::OFFLINE:  return PrinterStatusStrings::OFFLINE;
        default:                     return PrinterStatusStrings::OFFLINE;
    }
}

int8_t TunnelClient::findPrinterBySerial(const String& serial) {
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        PrinterClient* printer = _printerManager.getPrinter(i);
        if (printer) {
            String printerId = printer->getPrinterId();
            if (printerId == serial) {
                return i;
            }
        }
    }
    return -1;
}

// =============================================================================
// Registration
// =============================================================================

String TunnelClient::buildRegistrationUrl() {
    String baseUrl = _configStore.getCloudUrl();

    // Convert WebSocket URL to HTTP URL for API call
    // ws://host:port -> http://host:port
    // wss://host:port -> https://host:port
    String httpUrl = baseUrl;
    if (httpUrl.startsWith("wss://")) {
        httpUrl = "https://" + httpUrl.substring(6);
    } else if (httpUrl.startsWith("ws://")) {
        httpUrl = "http://" + httpUrl.substring(5);
    }

    // Ensure no trailing slash
    if (httpUrl.endsWith("/")) {
        httpUrl = httpUrl.substring(0, httpUrl.length() - 1);
    }

    // Append registration endpoint
    httpUrl += "/api/v1/hubs/register";

    return httpUrl;
}

bool TunnelClient::registerWithCloud() {
    String url = buildRegistrationUrl();
    DEBUG_PRINTF("[Tunnel] Registering at: %s\n", url.c_str());

    // Build registration request body
    JsonDocument doc;
    doc["hub_id"] = _configStore.getHubId();
    doc["mac_address"] = _configStore.getMacAddress();
    doc["firmware_version"] = FIRMWARE_VERSION;

    // Include tenant_id and claim_token if available
    String tenantId = _configStore.getTenantId();
    String claimToken = _configStore.getClaimToken();

    if (tenantId.length() > 0) {
        doc["tenant_id"] = tenantId;
    }
    if (claimToken.length() > 0) {
        doc["claim_token"] = claimToken;
    }

    String requestBody;
    serializeJson(doc, requestBody);
    DEBUG_PRINTF("[Tunnel] Registration body: %s\n", requestBody.c_str());

    // Make HTTP POST request
    HTTPClient http;
    WiFiClient* client = nullptr;
    WiFiClientSecure* secureClient = nullptr;

    if (url.startsWith("https://")) {
        secureClient = new WiFiClientSecure();
        secureClient->setInsecure();  // Skip certificate verification
        http.begin(*secureClient, url);
    } else {
        client = new WiFiClient();
        http.begin(*client, url);
    }

    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);  // 10 second timeout

    int httpCode = http.POST(requestBody);
    String response = http.getString();

    DEBUG_PRINTF("[Tunnel] Registration response: %d - %s\n", httpCode, response.c_str());

    bool success = false;

    if (httpCode == 200 || httpCode == 201) {
        // Parse response
        JsonDocument responseDoc;
        DeserializationError error = deserializeJson(responseDoc, response);

        if (!error) {
            const char* responseHubId = responseDoc["hub_id"];
            const char* responseTenantId = responseDoc["tenant_id"];
            bool claimed = responseDoc["claimed"] | false;

            DEBUG_PRINTF("[Tunnel] Registered! Hub: %s, Tenant: %s, Claimed: %s\n",
                         responseHubId ? responseHubId : "null",
                         responseTenantId ? responseTenantId : "null",
                         claimed ? "yes" : "no");

            // Mark as registered
            _configStore.setRegistered(true);
            success = true;
        } else {
            DEBUG_PRINTF("[Tunnel] Failed to parse registration response: %s\n", error.c_str());
        }
    } else if (httpCode == 409) {
        // Hub already registered - this is fine, mark as registered
        DEBUG_PRINTLN("[Tunnel] Hub already registered (409 Conflict)");
        _configStore.setRegistered(true);
        success = true;
    } else {
        DEBUG_PRINTF("[Tunnel] Registration failed with HTTP %d\n", httpCode);

        // Parse error response if possible
        JsonDocument errorDoc;
        if (!deserializeJson(errorDoc, response)) {
            const char* errorMsg = errorDoc["error"];
            const char* message = errorDoc["message"];
            if (errorMsg) {
                DEBUG_PRINTF("[Tunnel] Error: %s\n", errorMsg);
            }
            if (message) {
                DEBUG_PRINTF("[Tunnel] Message: %s\n", message);
            }
        }
    }

    http.end();

    // Clean up
    if (secureClient) delete secureClient;
    if (client) delete client;

    return success;
}
