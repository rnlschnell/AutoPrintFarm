#include "CloudClient.h"
#include "CloudMessages.h"
#include "../config.h"

// =============================================================================
// Constructor
// =============================================================================

CloudClient::CloudClient(HubConfigStore& hubConfigStore)
    : _hubConfigStore(hubConfigStore)
    , _state(CloudState::OFFLINE)
    , _lastActivityTime(0)
    , _lastPingTime(0)
    , _lastReconnectAttempt(0)
    , _authStartTime(0)
    , _failedStateStartTime(0)
    , _reconnectAttempts(0)
    , _cloudDisabled(false)
{
}

// =============================================================================
// Public Methods
// =============================================================================

void CloudClient::begin() {
    Serial.println("[Cloud] Initializing CloudClient");

    // Set up WebSocket event callback
    _wsClient.onEvent([this](websockets::WebsocketsEvent event, String data) {
        this->onEvent(event, data);
    });

    // Set up WebSocket message callback
    _wsClient.onMessage([this](websockets::WebsocketsMessage message) {
        this->onMessage(message);
    });

    Serial.println("[Cloud] CloudClient initialized");
}

void CloudClient::connect() {
    if (_state != CloudState::OFFLINE && _state != CloudState::RECONNECTING) {
        Serial.println("[Cloud] Already connecting or connected");
        return;
    }

    if (!_hubConfigStore.hasHubConfig()) {
        Serial.println("[Cloud] No hub configuration, cannot connect");
        return;
    }

    String url = buildWebSocketUrl();
    Serial.print("[Cloud] Connecting to: ");
    Serial.println(url);

    transitionTo(CloudState::CONNECTING);

    // For development, skip certificate verification
    #if !CLOUD_USE_SSL
        // No SSL, plain WebSocket
    #else
        _wsClient.setInsecure();  // Skip certificate verification for now
    #endif

    bool connected = _wsClient.connect(url);

    if (!connected) {
        Serial.println("[Cloud] WebSocket connection failed immediately");
        transitionTo(CloudState::RECONNECTING);
    }
    // If connection succeeded, onEvent will be called with Connected event
}

void CloudClient::disconnect() {
    Serial.println("[Cloud] Disconnecting");
    _wsClient.close();
    transitionTo(CloudState::OFFLINE);
}

void CloudClient::poll() {
    // Always poll WebSocket for events
    if (_wsClient.available()) {
        _wsClient.poll();
    }

    unsigned long now = millis();

    switch (_state) {
        case CloudState::OFFLINE:
            // Nothing to do, waiting for connect() call
            break;

        case CloudState::CONNECTING:
            // Handled by WebSocket callbacks
            break;

        case CloudState::AUTHENTICATING:
            // Check for authentication timeout
            if (now - _authStartTime > CLOUD_AUTH_TIMEOUT_MS) {
                Serial.println("[Cloud] Authentication timeout");
                _wsClient.close();
                transitionTo(CloudState::RECONNECTING);
            }
            break;

        case CloudState::CONNECTED:
            // Handle heartbeat
            handleHeartbeat();
            break;

        case CloudState::RECONNECTING:
            // Attempt reconnection with backoff
            attemptReconnect();
            break;

        case CloudState::FAILED:
            // Check if we should reset after timeout
            if (now - _failedStateStartTime > CLOUD_FAILED_RESET_MS) {
                Serial.println("[Cloud] Resetting from FAILED state");
                _reconnectAttempts = 0;
                transitionTo(CloudState::OFFLINE);
            }
            break;
    }
}

bool CloudClient::isConnected() const {
    return _state == CloudState::CONNECTED;
}

bool CloudClient::isCloudDisabled() const {
    return _cloudDisabled;
}

CloudState CloudClient::getState() const {
    return _state;
}

const char* CloudClient::stateToString(CloudState state) {
    switch (state) {
        case CloudState::OFFLINE:        return "OFFLINE";
        case CloudState::CONNECTING:     return "CONNECTING";
        case CloudState::AUTHENTICATING: return "AUTHENTICATING";
        case CloudState::CONNECTED:      return "CONNECTED";
        case CloudState::RECONNECTING:   return "RECONNECTING";
        case CloudState::FAILED:         return "FAILED";
        default:                         return "UNKNOWN";
    }
}

// =============================================================================
// Internal Methods
// =============================================================================

String CloudClient::buildWebSocketUrl() {
    String hubId;
    String tenantId;
    _hubConfigStore.loadHubConfig(hubId, tenantId);

    String url;
    #if CLOUD_USE_SSL
        url = "wss://";
    #else
        url = "ws://";
    #endif

    url += CLOUD_WS_HOST;
    url += ":";
    url += CLOUD_WS_PORT;
    url += CLOUD_WS_PATH;
    url += hubId;

    return url;
}

void CloudClient::onConnect() {
    Serial.println("[Cloud] WebSocket connected");
    _reconnectAttempts = 0;
    _lastActivityTime = millis();

    // Transition to authenticating and send hub_hello
    transitionTo(CloudState::AUTHENTICATING);
    _authStartTime = millis();
    sendHubHello();
}

void CloudClient::onDisconnect() {
    Serial.println("[Cloud] WebSocket disconnected");

    if (_state == CloudState::CONNECTED || _state == CloudState::AUTHENTICATING) {
        transitionTo(CloudState::RECONNECTING);
    }
}

void CloudClient::onEvent(websockets::WebsocketsEvent event, String data) {
    switch (event) {
        case websockets::WebsocketsEvent::ConnectionOpened:
            onConnect();
            break;

        case websockets::WebsocketsEvent::ConnectionClosed:
            onDisconnect();
            break;

        case websockets::WebsocketsEvent::GotPing:
            Serial.println("[Cloud] Got ping, sending pong");
            _wsClient.pong();
            _lastActivityTime = millis();
            break;

        case websockets::WebsocketsEvent::GotPong:
            Serial.println("[Cloud] Got pong");
            _lastActivityTime = millis();
            break;
    }
}

void CloudClient::onMessage(websockets::WebsocketsMessage message) {
    _lastActivityTime = millis();

    if (message.isText()) {
        String payload = message.data();
        Serial.print("[Cloud] Received: ");
        Serial.println(payload);

        // Parse JSON
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);

        if (error) {
            Serial.print("[Cloud] JSON parse error: ");
            Serial.println(error.c_str());
            return;
        }

        // Get message type
        const char* type = doc["type"];
        if (!type) {
            Serial.println("[Cloud] Message missing 'type' field");
            return;
        }

        // Route message to appropriate handler
        if (strcmp(type, CloudMessages::HUB_WELCOME) == 0) {
            handleHubWelcome(doc);
        } else if (strcmp(type, CloudMessages::HUB_CONFIG) == 0) {
            handleHubConfig(doc);
        } else if (strcmp(type, CloudMessages::CONFIGURE_PRINTER) == 0) {
            handleConfigurePrinter(doc);
        } else if (strcmp(type, CloudMessages::PRINTER_COMMAND) == 0) {
            handlePrinterCommand(doc);
        } else if (strcmp(type, CloudMessages::PRINT_COMMAND) == 0) {
            handlePrintCommand(doc);
        } else if (strcmp(type, CloudMessages::DISCOVER_PRINTERS) == 0) {
            handleDiscoverPrinters(doc);
        } else if (strcmp(type, CloudMessages::HUB_COMMAND) == 0) {
            handleHubCommand(doc);
        } else if (strcmp(type, CloudMessages::ERROR) == 0) {
            handleError(doc);
        } else {
            Serial.print("[Cloud] Unknown message type: ");
            Serial.println(type);
        }
    }
}

// =============================================================================
// Message Handlers
// =============================================================================

void CloudClient::handleHubWelcome(JsonDocument& doc) {
    Serial.println("[Cloud] Received hub_welcome - authenticated!");

    // Extract and save hub name if provided
    const char* hubName = doc["hub_name"];
    if (hubName && strlen(hubName) > 0) {
        String currentName = _hubConfigStore.getStoredHubName();
        if (currentName != hubName) {
            _hubConfigStore.saveHubName(hubName);
            Serial.printf("[Cloud] Hub name updated to: %s\n", hubName);
        }
    }

    if (_state == CloudState::AUTHENTICATING) {
        transitionTo(CloudState::CONNECTED);
        _lastPingTime = millis();  // Reset ping timer
    }
}

void CloudClient::handleHubConfig(JsonDocument& doc) {
    const char* commandId = doc["command_id"];

    Serial.println("[Cloud] Received hub_config update");

    bool success = true;
    String error = "";

    // Handle hub name update
    if (doc["hub_name"].is<const char*>()) {
        const char* hubName = doc["hub_name"];
        if (hubName) {
            String currentName = _hubConfigStore.getStoredHubName();
            if (currentName != hubName) {
                if (_hubConfigStore.saveHubName(hubName)) {
                    Serial.printf("[Cloud] Hub name updated to: %s\n", hubName);
                } else {
                    success = false;
                    error = "Failed to save hub name";
                }
            }
        }
    }

    // Send acknowledgment if command_id was provided
    if (commandId) {
        sendCommandAck(commandId, success, error);
    }
}

void CloudClient::handleConfigurePrinter(JsonDocument& doc) {
    // TODO: Implement printer configuration
    const char* action = doc["action"];
    const char* commandId = doc["command_id"];

    Serial.print("[Cloud] Configure printer: action=");
    Serial.println(action ? action : "null");

    // For now, just acknowledge the command
    // In the future, this will integrate with PrinterManager
}

void CloudClient::handlePrinterCommand(JsonDocument& doc) {
    // TODO: Implement printer control commands
    const char* action = doc["action"];
    const char* printerId = doc["printer_id"];
    const char* commandId = doc["command_id"];

    Serial.print("[Cloud] Printer command: action=");
    Serial.print(action ? action : "null");
    Serial.print(", printer=");
    Serial.println(printerId ? printerId : "null");

    // For now, just acknowledge the command
}

void CloudClient::handlePrintCommand(JsonDocument& doc) {
    // TODO: Implement print job commands
    const char* action = doc["action"];
    const char* printerId = doc["printer_id"];
    const char* commandId = doc["command_id"];

    Serial.print("[Cloud] Print command: action=");
    Serial.print(action ? action : "null");
    Serial.print(", printer=");
    Serial.println(printerId ? printerId : "null");

    // For now, just acknowledge the command
}

void CloudClient::handleDiscoverPrinters(JsonDocument& doc) {
    // TODO: Implement printer discovery
    const char* commandId = doc["command_id"];

    Serial.println("[Cloud] Discover printers requested");

    // For now, just acknowledge the command
    sendCommandAck(commandId, true);
}

void CloudClient::handleHubCommand(JsonDocument& doc) {
    const char* action = doc["action"];
    const char* commandId = doc["command_id"];

    if (!action || !commandId) {
        Serial.println("[Cloud] Hub command missing action or command_id");
        return;
    }

    bool success = false;
    String error = "";

    if (strcmp(action, "disconnect") == 0) {
        Serial.println("[Cloud] Disconnect command received");
        // Set flag to disable auto-reconnect
        _cloudDisabled = true;
        success = true;
        // Send ack before disconnecting
        sendCommandAck(commandId, true, "");
        // Small delay to allow ack to be transmitted before closing socket
        delay(100);
        // Disconnect after sending ack
        disconnect();
        return;
    }
    else if (strcmp(action, "gpio_set") == 0) {
        int pin = doc["gpio_pin"] | -1;
        bool state = doc["gpio_state"] | false;

        if (pin >= 0) {
            Serial.printf("[Cloud] Setting GPIO %d to %s\n", pin, state ? "HIGH" : "LOW");
            pinMode(pin, OUTPUT);
            digitalWrite(pin, state ? HIGH : LOW);
            success = true;
        } else {
            error = "Invalid GPIO pin";
        }
    }
    else {
        error = "Unknown hub command action";
        Serial.printf("[Cloud] Unknown hub command action: %s\n", action);
    }

    sendCommandAck(commandId, success, error);
}

void CloudClient::handleError(JsonDocument& doc) {
    const char* errorMsg = doc["message"];
    const char* code = doc["code"];

    Serial.print("[Cloud] Error from cloud: ");
    Serial.print(code ? code : "unknown");
    Serial.print(" - ");
    Serial.println(errorMsg ? errorMsg : "no message");
}

// =============================================================================
// Outgoing Messages
// =============================================================================

void CloudClient::sendHubHello() {
    String hubId;
    String tenantId;
    _hubConfigStore.loadHubConfig(hubId, tenantId);

    JsonDocument doc;
    doc["type"] = HubMessages::HUB_HELLO;
    doc["hub_id"] = hubId;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["hardware_version"] = HARDWARE_VERSION;

    String json;
    serializeJson(doc, json);

    Serial.print("[Cloud] Sending hub_hello: ");
    Serial.println(json);

    sendMessage(json);
}

void CloudClient::sendMessage(const String& json) {
    if (_wsClient.available()) {
        _wsClient.send(json);
        _lastActivityTime = millis();
    } else {
        Serial.println("[Cloud] Cannot send - WebSocket not available");
    }
}

void CloudClient::sendCommandAck(const char* commandId, bool success, const String& error) {
    JsonDocument doc;
    doc["type"] = HubMessages::COMMAND_ACK;
    doc["command_id"] = commandId;
    doc["success"] = success;
    if (error.length() > 0) {
        doc["error"] = error;
    }

    String json;
    serializeJson(doc, json);

    Serial.print("[Cloud] Sending command_ack: ");
    Serial.println(json);

    sendMessage(json);
}

// =============================================================================
// Reconnection Logic
// =============================================================================

unsigned long CloudClient::getReconnectDelay() const {
    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to max
    unsigned long delay = CLOUD_RECONNECT_INITIAL_MS << _reconnectAttempts;
    if (delay > CLOUD_RECONNECT_MAX_MS) {
        delay = CLOUD_RECONNECT_MAX_MS;
    }
    return delay;
}

void CloudClient::attemptReconnect() {
    unsigned long now = millis();
    unsigned long delay = getReconnectDelay();

    if (now - _lastReconnectAttempt < delay) {
        return;  // Not time to retry yet
    }

    _reconnectAttempts++;
    _lastReconnectAttempt = now;

    Serial.print("[Cloud] Reconnection attempt ");
    Serial.print(_reconnectAttempts);
    Serial.print("/");
    Serial.print(CLOUD_MAX_RECONNECT_ATTEMPTS);
    Serial.print(" (delay: ");
    Serial.print(delay);
    Serial.println("ms)");

    if (_reconnectAttempts > CLOUD_MAX_RECONNECT_ATTEMPTS) {
        Serial.println("[Cloud] Max reconnection attempts exceeded");
        transitionTo(CloudState::FAILED);
        return;
    }

    // Attempt to connect
    String url = buildWebSocketUrl();

    #if CLOUD_USE_SSL
        _wsClient.setInsecure();
    #endif

    bool connected = _wsClient.connect(url);

    if (!connected) {
        Serial.println("[Cloud] Reconnection failed");
        // Stay in RECONNECTING, will retry after delay
    }
    // If connection succeeded, onEvent will handle state transition
}

void CloudClient::transitionTo(CloudState newState) {
    if (_state == newState) {
        return;
    }

    Serial.print("[Cloud] State: ");
    Serial.print(stateToString(_state));
    Serial.print(" -> ");
    Serial.println(stateToString(newState));

    _state = newState;

    // Handle state-specific initialization
    switch (newState) {
        case CloudState::FAILED:
            _failedStateStartTime = millis();
            break;

        case CloudState::RECONNECTING:
            _lastReconnectAttempt = 0;  // Allow immediate first attempt
            break;

        default:
            break;
    }
}

// =============================================================================
// Heartbeat
// =============================================================================

void CloudClient::handleHeartbeat() {
    unsigned long now = millis();

    // Send ping if interval elapsed
    if (now - _lastPingTime > CLOUD_PING_INTERVAL_MS) {
        Serial.println("[Cloud] Sending ping");
        _wsClient.ping();
        _lastPingTime = now;
    }

    // Check for pong timeout (no activity for too long)
    if (now - _lastActivityTime > CLOUD_PONG_TIMEOUT_MS) {
        Serial.println("[Cloud] Heartbeat timeout - no activity");
        _wsClient.close();
        transitionTo(CloudState::RECONNECTING);
    }
}
