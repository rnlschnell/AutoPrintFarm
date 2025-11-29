#include "BambuMqttClient.h"
#include <ArduinoJson.h>

// Static instance pointer for MQTT callbacks
BambuMqttClient* BambuMqttClient::_instance = nullptr;

BambuMqttClient::BambuMqttClient() : _statusCallback(nullptr) {
    _instance = this;

    // Initialize all printer slots
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        _printers[i].connected = false;
        _printers[i].lastReconnectAttempt = 0;
        _printers[i].lastStatusBroadcast = 0;
        memset(&_printers[i].config, 0, sizeof(PrinterConfig));
        memset(&_printers[i].lastStatus, 0, sizeof(PrinterStatus));
    }
}

void BambuMqttClient::begin() {
    Serial.println("[BambuMqtt] Initializing...");

    // Initialize config store
    if (!_configStore.begin()) {
        Serial.println("[BambuMqtt] Failed to initialize config store");
        return;
    }

    // Load saved printer configurations
    PrinterConfig configs[MAX_PRINTERS];
    uint8_t count = _configStore.loadAllPrinters(configs);

    Serial.printf("[BambuMqtt] Loaded %d printer configuration(s)\n", count);

    // Copy configs to printer connections
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (configs[i].active) {
            memcpy(&_printers[i].config, &configs[i], sizeof(PrinterConfig));
            Serial.printf("[BambuMqtt] Slot %d: %s @ %s\n",
                          i, configs[i].serial_number, configs[i].ip_address);
        }
    }

    // Set up MQTT message callbacks for each slot
    _printers[0].mqttClient.onMessage(onMessage0);
    _printers[1].mqttClient.onMessage(onMessage1);
    _printers[2].mqttClient.onMessage(onMessage2);
    _printers[3].mqttClient.onMessage(onMessage3);
    _printers[4].mqttClient.onMessage(onMessage4);

    Serial.println("[BambuMqtt] Initialized");
}

void BambuMqttClient::poll() {
    unsigned long now = millis();

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        PrinterConnection& p = _printers[i];

        // Skip inactive slots
        if (!p.config.active) {
            continue;
        }

        if (p.connected) {
            // Process incoming MQTT messages
            p.mqttClient.loop();

            // Debug: Log that we're polling this printer
            static unsigned long lastDebugLog = 0;
            if (now - lastDebugLog > 10000) {  // Every 10 seconds
                Serial.printf("[BambuMqtt] Polling printer %s (slot %d), MQTT connected: %s\n",
                              p.config.serial_number, i, p.mqttClient.connected() ? "yes" : "no");
                lastDebugLog = now;
            }

            // Check connection health
            if (!p.mqttClient.connected()) {
                unsigned long connectedDuration = now - p.lastReconnectAttempt;
                Serial.printf("[BambuMqtt] Lost connection to printer %s after %lu ms\n",
                              p.config.serial_number, connectedDuration);
                p.connected = false;
                p.lastReconnectAttempt = now;

                // Update status to offline
                strcpy(p.lastStatus.status, "offline");
                p.lastStatus.is_connected = false;
                broadcastStatus(i, true);  // Force broadcast disconnect
            } else {
                // Periodically request status update (every 30 seconds)
                if (now - p.lastPushAll >= 30000) {
                    sendPushAll(i);
                    p.lastPushAll = now;
                }
            }
        } else {
            // Attempt reconnect with interval
            if (now - p.lastReconnectAttempt >= MQTT_RECONNECT_INTERVAL_MS) {
                connectPrinter(i);
            }
        }
    }
}

void BambuMqttClient::connectPrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) return;

    PrinterConnection& p = _printers[slot];

    if (!p.config.active || p.connected) {
        return;
    }

    Serial.printf("[BambuMqtt] Connecting to printer %s @ %s...\n",
                  p.config.serial_number, p.config.ip_address);

    // Configure TLS - Bambu uses self-signed certificates
    p.wifiClient.setInsecure();

    // Configure MQTT client
    p.mqttClient.begin(p.config.ip_address, MQTT_BAMBU_PORT, p.wifiClient);
    p.mqttClient.setKeepAlive(MQTT_KEEPALIVE_SECONDS);

    // Re-register message callback (begin() resets it)
    switch (slot) {
        case 0: p.mqttClient.onMessage(onMessage0); break;
        case 1: p.mqttClient.onMessage(onMessage1); break;
        case 2: p.mqttClient.onMessage(onMessage2); break;
        case 3: p.mqttClient.onMessage(onMessage3); break;
        case 4: p.mqttClient.onMessage(onMessage4); break;
    }

    // Generate unique client ID
    char clientId[64];
    snprintf(clientId, sizeof(clientId), "printfarm_%s_%lu",
             p.config.serial_number, millis() % 10000);

    // Attempt connection with Bambu credentials
    bool connected = p.mqttClient.connect(clientId, MQTT_BAMBU_USER, p.config.access_code);

    p.lastReconnectAttempt = millis();

    if (connected) {
        p.connected = true;

        // Subscribe to printer status reports
        char topic[64];
        snprintf(topic, sizeof(topic), "device/%s/report", p.config.serial_number);
        p.mqttClient.subscribe(topic);

        Serial.printf("[BambuMqtt] Connected to printer %s, subscribed to %s\n",
                      p.config.serial_number, topic);

        // Initialize status
        strcpy(p.lastStatus.serial_number, p.config.serial_number);
        strcpy(p.lastStatus.status, "idle");
        p.lastStatus.is_connected = true;
        p.lastPushAll = 0;  // Allow immediate pushall
        broadcastStatus(slot, true);  // Force broadcast connection

        // Request full status from printer
        sendPushAll(slot);
        p.lastPushAll = millis();  // Reset timer after initial pushall
    } else {
        Serial.printf("[BambuMqtt] Failed to connect to printer %s\n", p.config.serial_number);
    }
}

void BambuMqttClient::disconnectPrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) return;

    PrinterConnection& p = _printers[slot];

    if (p.connected) {
        p.mqttClient.disconnect();
        p.connected = false;
        Serial.printf("[BambuMqtt] Disconnected from printer %s\n", p.config.serial_number);
    }
}

void BambuMqttClient::sendPushAll(uint8_t slot) {
    if (slot >= MAX_PRINTERS) return;

    PrinterConnection& p = _printers[slot];
    if (!p.connected) return;

    // Build the pushall request topic and payload
    char topic[64];
    snprintf(topic, sizeof(topic), "device/%s/request", p.config.serial_number);

    // Bambu pushall command - requests full status report
    const char* payload = "{\"pushing\":{\"sequence_id\":\"0\",\"command\":\"pushall\"}}";

    if (p.mqttClient.publish(topic, payload)) {
        Serial.printf("[BambuMqtt] Sent pushall to printer %s\n", p.config.serial_number);
    } else {
        Serial.printf("[BambuMqtt] Failed to send pushall to printer %s\n", p.config.serial_number);
    }
}

bool BambuMqttClient::addPrinter(const PrinterConfig& config) {
    Serial.printf("[BambuMqtt] Adding printer: %s @ %s\n",
                  config.serial_number, config.ip_address);

    // Check if printer already exists
    int8_t existingSlot = _configStore.findPrinterBySerial(config.serial_number);
    if (existingSlot >= 0) {
        Serial.printf("[BambuMqtt] Printer %s already exists in slot %d\n",
                      config.serial_number, existingSlot);
        return false;
    }

    // Find empty slot
    int8_t slot = _configStore.findEmptySlot();
    if (slot < 0) {
        Serial.println("[BambuMqtt] No empty slots available (max 5 printers)");
        return false;
    }

    // Save to NVS
    PrinterConfig configToSave = config;
    configToSave.active = true;

    if (!_configStore.savePrinter(slot, configToSave)) {
        Serial.println("[BambuMqtt] Failed to save printer config");
        return false;
    }

    // Update runtime config
    memcpy(&_printers[slot].config, &configToSave, sizeof(PrinterConfig));
    _printers[slot].connected = false;
    _printers[slot].lastReconnectAttempt = 0;

    Serial.printf("[BambuMqtt] Added printer %s to slot %d\n",
                  config.serial_number, slot);

    // Immediately attempt connection
    connectPrinter(slot);

    return true;
}

bool BambuMqttClient::removePrinter(const char* serialNumber) {
    Serial.printf("[BambuMqtt] Removing printer: %s\n", serialNumber);

    int8_t slot = _configStore.findPrinterBySerial(serialNumber);
    if (slot < 0) {
        Serial.printf("[BambuMqtt] Printer %s not found\n", serialNumber);
        return false;
    }

    // Disconnect if connected
    disconnectPrinter(slot);

    // Remove from NVS
    if (!_configStore.removePrinter(slot)) {
        Serial.println("[BambuMqtt] Failed to remove printer from NVS");
        return false;
    }

    // Clear runtime config
    memset(&_printers[slot].config, 0, sizeof(PrinterConfig));
    memset(&_printers[slot].lastStatus, 0, sizeof(PrinterStatus));

    Serial.printf("[BambuMqtt] Removed printer from slot %d\n", slot);

    return true;
}

bool BambuMqttClient::updatePrinter(const PrinterConfig& config) {
    Serial.printf("[BambuMqtt] Updating printer: %s\n", config.serial_number);

    int8_t slot = _configStore.findPrinterBySerial(config.serial_number);
    if (slot < 0) {
        Serial.printf("[BambuMqtt] Printer %s not found, adding instead\n",
                      config.serial_number);
        return addPrinter(config);
    }

    // Disconnect current connection
    disconnectPrinter(slot);

    // Save updated config
    PrinterConfig configToSave = config;
    configToSave.active = true;

    if (!_configStore.savePrinter(slot, configToSave)) {
        Serial.println("[BambuMqtt] Failed to save updated printer config");
        return false;
    }

    // Update runtime config
    memcpy(&_printers[slot].config, &configToSave, sizeof(PrinterConfig));
    _printers[slot].lastReconnectAttempt = 0;  // Reconnect immediately

    Serial.printf("[BambuMqtt] Updated printer %s in slot %d\n",
                  config.serial_number, slot);

    return true;
}

void BambuMqttClient::setStatusCallback(PrinterStatusCallback callback) {
    _statusCallback = callback;
}

bool BambuMqttClient::isPrinterConnected(const char* serialNumber) {
    int8_t slot = _configStore.findPrinterBySerial(serialNumber);
    if (slot < 0) {
        return false;
    }
    return _printers[slot].connected;
}

uint8_t BambuMqttClient::getConnectedCount() {
    uint8_t count = 0;
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i].connected) {
            count++;
        }
    }
    return count;
}

uint8_t BambuMqttClient::getConfiguredCount() {
    uint8_t count = 0;
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i].config.active) {
            count++;
        }
    }
    return count;
}

bool BambuMqttClient::setLight(const char* serialNumber, bool turnOn) {
    int8_t slot = _configStore.findPrinterBySerial(serialNumber);
    if (slot < 0) {
        Serial.printf("[BambuMqtt] Light control: printer %s not found\n", serialNumber);
        return false;
    }

    PrinterConnection& p = _printers[slot];
    if (!p.connected) {
        Serial.printf("[BambuMqtt] Light control: printer %s not connected\n", serialNumber);
        return false;
    }

    char topic[64];
    snprintf(topic, sizeof(topic), "device/%s/request", p.config.serial_number);

    // Send both chamber_light (X1C/P1S) and work_light (A1/A1 Mini) commands
    // The printer will ignore the one it doesn't support
    const char* mode = turnOn ? "on" : "off";

    // Chamber light for X1C/P1S/P1P
    char payload1[256];
    snprintf(payload1, sizeof(payload1),
        "{\"system\":{\"sequence_id\":\"0\",\"command\":\"ledctrl\",\"led_node\":\"chamber_light\",\"led_mode\":\"%s\",\"led_on_time\":500,\"led_off_time\":500,\"loop_times\":1,\"interval_time\":1000}}",
        mode);

    // Work light for A1/A1 Mini
    char payload2[256];
    snprintf(payload2, sizeof(payload2),
        "{\"system\":{\"sequence_id\":\"0\",\"command\":\"ledctrl\",\"led_node\":\"work_light\",\"led_mode\":\"%s\",\"led_on_time\":500,\"led_off_time\":500,\"loop_times\":1,\"interval_time\":1000}}",
        mode);

    bool success1 = p.mqttClient.publish(topic, payload1);
    bool success2 = p.mqttClient.publish(topic, payload2);

    if (success1 || success2) {
        Serial.printf("[BambuMqtt] Light %s command sent to %s\n",
                      turnOn ? "ON" : "OFF", serialNumber);
        return true;
    } else {
        Serial.printf("[BambuMqtt] Failed to send light command to %s\n", serialNumber);
        return false;
    }
}

void BambuMqttClient::handleMessage(uint8_t slot, String& topic, String& payload) {
    if (slot >= MAX_PRINTERS) return;

    Serial.printf("[BambuMqtt] Received message on topic: %s (len=%d)\n", topic.c_str(), payload.length());

    // Parse the JSON status
    parseStatusJson(slot, payload.c_str());

    // Broadcast with throttling
    broadcastStatus(slot);
}

void BambuMqttClient::parseStatusJson(uint8_t slot, const char* json) {
    PrinterConnection& p = _printers[slot];

    // Use JsonDocument for parsing Bambu status messages
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("[BambuMqtt] JSON parse error for %s: %s\n",
                      p.config.serial_number, error.c_str());
        return;
    }

    // Bambu status is nested under "print" object
    JsonObject print = doc["print"];
    if (print.isNull()) {
        // Not a print status message - log what we got for debugging
        Serial.printf("[BambuMqtt] No 'print' object in message. Keys: ");
        for (JsonPair kv : doc.as<JsonObject>()) {
            Serial.printf("%s, ", kv.key().c_str());
        }
        Serial.println();
        return;
    }

    // Update serial number (should already be set)
    strcpy(p.lastStatus.serial_number, p.config.serial_number);
    p.lastStatus.is_connected = true;

    // Extract gcode_state and map to our status
    const char* gcodeState = print["gcode_state"] | "UNKNOWN";

    if (strcmp(gcodeState, "RUNNING") == 0) {
        strcpy(p.lastStatus.status, "printing");
    } else if (strcmp(gcodeState, "PAUSE") == 0) {
        strcpy(p.lastStatus.status, "paused");
    } else if (strcmp(gcodeState, "FAILED") == 0) {
        strcpy(p.lastStatus.status, "error");
    } else if (strcmp(gcodeState, "FINISH") == 0 ||
               strcmp(gcodeState, "IDLE") == 0 ||
               strcmp(gcodeState, "READY") == 0) {
        strcpy(p.lastStatus.status, "idle");
    } else {
        strcpy(p.lastStatus.status, "idle");
    }

    // Extract temperatures - only update if present in message to avoid zeroing
    // (Bambu sends different message types, not all contain temperature data)
    // Using .is<T>() to check existence (ArduinoJson 7.x preferred API)
    bool hasNozzle = print["nozzle_temper"].is<float>();
    bool hasBed = print["bed_temper"].is<float>();

    if (hasNozzle) {
        p.lastStatus.nozzle_temp = print["nozzle_temper"].as<float>();
    }
    if (print["nozzle_target_temper"].is<float>()) {
        p.lastStatus.nozzle_target = print["nozzle_target_temper"].as<float>();
    }
    if (hasBed) {
        p.lastStatus.bed_temp = print["bed_temper"].as<float>();
    }
    if (print["bed_target_temper"].is<float>()) {
        p.lastStatus.bed_target = print["bed_target_temper"].as<float>();
    }
    if (print["chamber_temper"].is<float>()) {
        p.lastStatus.chamber_temp = print["chamber_temper"].as<float>();
    }

    // Debug: Log temperature extraction results
    Serial.printf("[BambuMqtt] Temps - has_nozzle:%d has_bed:%d nozzle:%.1f bed:%.1f\n",
                  hasNozzle, hasBed, p.lastStatus.nozzle_temp, p.lastStatus.bed_temp);

    // Extract progress info - only update if present in message
    if (print["mc_percent"].is<int>()) {
        p.lastStatus.progress_percent = print["mc_percent"].as<int>();
    }
    if (print["layer_num"].is<int>()) {
        p.lastStatus.current_layer = print["layer_num"].as<int>();
    }
    if (print["total_layer_num"].is<int>()) {
        p.lastStatus.total_layers = print["total_layer_num"].as<int>();
    }
    if (print["mc_remaining_time"].is<int>()) {
        // Remaining time is in minutes, convert to seconds
        int remainingMinutes = print["mc_remaining_time"].as<int>();
        p.lastStatus.remaining_time_seconds = remainingMinutes * 60;
    }
}

void BambuMqttClient::broadcastStatus(uint8_t slot, bool force) {
    if (slot >= MAX_PRINTERS || !_statusCallback) {
        return;
    }

    PrinterConnection& p = _printers[slot];
    unsigned long now = millis();

    // Throttle broadcasts unless forced
    if (!force && (now - p.lastStatusBroadcast < MQTT_STATUS_THROTTLE_MS)) {
        return;
    }

    p.lastStatusBroadcast = now;

    // Invoke callback
    _statusCallback(p.lastStatus);
}

// Static callback wrappers - route to instance method
void BambuMqttClient::onMessage0(String& topic, String& payload) {
    if (_instance) _instance->handleMessage(0, topic, payload);
}

void BambuMqttClient::onMessage1(String& topic, String& payload) {
    if (_instance) _instance->handleMessage(1, topic, payload);
}

void BambuMqttClient::onMessage2(String& topic, String& payload) {
    if (_instance) _instance->handleMessage(2, topic, payload);
}

void BambuMqttClient::onMessage3(String& topic, String& payload) {
    if (_instance) _instance->handleMessage(3, topic, payload);
}

void BambuMqttClient::onMessage4(String& topic, String& payload) {
    if (_instance) _instance->handleMessage(4, topic, payload);
}
