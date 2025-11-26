#include "BambuClient.h"
#include "../config.h"

// Static instance map for callback routing
std::map<String, BambuClient*> BambuClient::_instanceMap;

BambuClient::BambuClient(const String& id, const String& name,
                         const String& ip, const String& accessCode,
                         const String& serial)
    : _id(id)
    , _name(name)
    , _ip(ip)
    , _accessCode(accessCode)
    , _serial(serial)
    , _wifiClient(nullptr)
    , _mqttClient(nullptr)
    , _sequenceId(0)
{
    // Build topic strings
    _reportTopic = "device/" + _serial + "/report";
    _requestTopic = "device/" + _serial + "/request";

    // Initialize status
    _status.printerType = "bambu";
    _status.connected = false;
    _status.state = PrinterState::OFFLINE;

    setupMQTT();

    DEBUG_PRINTF("[Bambu:%s] Created client for %s (%s)\n",
                 _id.c_str(), _name.c_str(), _ip.c_str());
}

BambuClient::~BambuClient() {
    disconnect();
    unregisterInstance();

    if (_mqttClient) {
        delete _mqttClient;
        _mqttClient = nullptr;
    }
    if (_wifiClient) {
        delete _wifiClient;
        _wifiClient = nullptr;
    }
}

void BambuClient::setupMQTT() {
    // Create TLS client
    _wifiClient = new WiFiClientSecure();

    // Skip certificate verification (Bambu uses self-signed certs)
    _wifiClient->setInsecure();

    // Set connection timeout
    _wifiClient->setTimeout(10);

    // Create MQTT client
    _mqttClient = new PubSubClient(*_wifiClient);
    _mqttClient->setServer(_ip.c_str(), BAMBU_MQTT_PORT);
    _mqttClient->setKeepAlive(BAMBU_KEEPALIVE_SEC);
    _mqttClient->setBufferSize(4096);  // Large buffer for Bambu's JSON payloads
    _mqttClient->setCallback(mqttCallbackStatic);
}

void BambuClient::registerInstance() {
    _instanceMap[_reportTopic] = this;
    DEBUG_PRINTF("[Bambu:%s] Registered for topic: %s\n", _id.c_str(), _reportTopic.c_str());
}

void BambuClient::unregisterInstance() {
    _instanceMap.erase(_reportTopic);
}

void BambuClient::mqttCallbackStatic(char* topic, byte* payload, unsigned int length) {
    String topicStr(topic);

    // Find the instance that owns this topic
    auto it = _instanceMap.find(topicStr);
    if (it != _instanceMap.end() && it->second != nullptr) {
        it->second->handleMessage((const char*)payload, length);
    } else {
        DEBUG_PRINTF("[Bambu] Received message for unknown topic: %s\n", topic);
    }
}

bool BambuClient::connect() {
    if (_mqttClient->connected()) {
        return true;
    }

    DEBUG_PRINTF("[Bambu:%s] Connecting to %s:%d...\n",
                 _id.c_str(), _ip.c_str(), BAMBU_MQTT_PORT);

    // Register this instance for callback routing
    registerInstance();

    // Generate unique client ID
    String clientId = "esp32-" + String(random(0xffff), HEX);

    // Attempt MQTT connection with Bambu credentials
    // Username: "bblp", Password: LAN access code
    if (_mqttClient->connect(clientId.c_str(), "bblp", _accessCode.c_str())) {
        DEBUG_PRINTF("[Bambu:%s] MQTT connected!\n", _id.c_str());

        // Subscribe to status reports
        if (_mqttClient->subscribe(_reportTopic.c_str())) {
            DEBUG_PRINTF("[Bambu:%s] Subscribed to: %s\n", _id.c_str(), _reportTopic.c_str());
        } else {
            DEBUG_PRINTF("[Bambu:%s] Failed to subscribe!\n", _id.c_str());
        }

        _status.connected = true;
        _status.state = PrinterState::UNKNOWN;  // Will be updated on first message
        _lastReconnectAttempt = 0;

        // Request full status update from printer
        requestPushAll();

        return true;
    }

    int state = _mqttClient->state();
    DEBUG_PRINTF("[Bambu:%s] Connection failed, rc=%d\n", _id.c_str(), state);

    // Log specific error codes
    switch (state) {
        case -4: DEBUG_PRINTLN("  -> Connection timeout"); break;
        case -3: DEBUG_PRINTLN("  -> Connection lost"); break;
        case -2: DEBUG_PRINTLN("  -> Connect failed"); break;
        case -1: DEBUG_PRINTLN("  -> Disconnected"); break;
        case 1:  DEBUG_PRINTLN("  -> Bad protocol"); break;
        case 2:  DEBUG_PRINTLN("  -> Bad client ID"); break;
        case 3:  DEBUG_PRINTLN("  -> Unavailable"); break;
        case 4:  DEBUG_PRINTLN("  -> Bad credentials"); break;
        case 5:  DEBUG_PRINTLN("  -> Unauthorized"); break;
    }

    _status.connected = false;
    _lastReconnectAttempt = millis();

    return false;
}

void BambuClient::disconnect() {
    if (_mqttClient && _mqttClient->connected()) {
        _mqttClient->unsubscribe(_reportTopic.c_str());
        _mqttClient->disconnect();
        DEBUG_PRINTF("[Bambu:%s] Disconnected\n", _id.c_str());
    }

    _status.connected = false;
    _status.state = PrinterState::OFFLINE;
}

bool BambuClient::isConnected() {
    return _mqttClient && _mqttClient->connected();
}

PrinterStatus BambuClient::getStatus() {
    _status.connected = isConnected();
    return _status;
}

void BambuClient::poll() {
    if (!_mqttClient) return;

    if (_mqttClient->connected()) {
        // Process incoming messages
        _mqttClient->loop();
    } else {
        // Attempt reconnection with backoff
        unsigned long now = millis();
        if (now - _lastReconnectAttempt >= BAMBU_RECONNECT_INTERVAL_MS) {
            DEBUG_PRINTF("[Bambu:%s] Attempting reconnect...\n", _id.c_str());
            reconnect();
        }
    }
}

bool BambuClient::reconnect() {
    _lastReconnectAttempt = millis();
    return connect();
}

void BambuClient::handleMessage(const char* payload, size_t length) {
    // Parse JSON payload
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
        DEBUG_PRINTF("[Bambu:%s] JSON parse error: %s\n", _id.c_str(), error.c_str());
        return;
    }

    // Bambu sends nested JSON with different message types
    // Common structures: {"print": {...}}, {"system": {...}}, {"info": {...}}

    // Check for "print" object (contains temperatures and print status)
    if (doc["print"].is<JsonObject>()) {
        JsonObject print = doc["print"];

        // Debug: Log lights_report if present
        if (print["lights_report"].is<JsonArray>()) {
            DEBUG_PRINTF("[Bambu:%s] lights_report: ", _id.c_str());
            String lightsJson;
            serializeJson(print["lights_report"], lightsJson);
            DEBUG_PRINTLN(lightsJson.c_str());
        }

        // Temperature extraction - check for numeric types (int or float)
        // Bambu sends temps as integers or floats depending on value
        JsonVariant nozzleTemp = print["nozzle_temper"];
        if (!nozzleTemp.isNull()) {
            _status.nozzleTemp = nozzleTemp.as<float>();
        }
        JsonVariant nozzleTarget = print["nozzle_target_temper"];
        if (!nozzleTarget.isNull()) {
            _status.nozzleTarget = nozzleTarget.as<float>();
        }
        JsonVariant bedTemp = print["bed_temper"];
        if (!bedTemp.isNull()) {
            _status.bedTemp = bedTemp.as<float>();
        }
        JsonVariant bedTarget = print["bed_target_temper"];
        if (!bedTarget.isNull()) {
            _status.bedTarget = bedTarget.as<float>();
        }

        // Print state
        if (print["gcode_state"].is<const char*>()) {
            String gcodeState = print["gcode_state"].as<String>();
            _status.stateString = gcodeState;
            DEBUG_PRINTF("[Bambu:%s] gcode_state: %s\n", _id.c_str(), gcodeState.c_str());

            // Map Bambu states to our enum
            if (gcodeState == "IDLE" || gcodeState == "FINISH") {
                _status.state = PrinterState::IDLE;
            } else if (gcodeState == "RUNNING" || gcodeState == "PREPARE") {
                _status.state = PrinterState::PRINTING;
            } else if (gcodeState == "PAUSE") {
                _status.state = PrinterState::PAUSED;
            } else if (gcodeState == "FAILED") {
                _status.state = PrinterState::ERROR;
            } else {
                _status.state = PrinterState::UNKNOWN;
            }
        }

        // Check for HMS errors (Health Management System)
        if (print["hms"].is<JsonArray>()) {
            JsonArray hms = print["hms"];
            if (hms.size() > 0) {
                DEBUG_PRINTF("[Bambu:%s] HMS errors present: %d\n", _id.c_str(), hms.size());
            }
        }

        // Print progress
        if (print["mc_percent"].is<float>()) {
            _status.progressPercent = print["mc_percent"].as<float>();
        }

        // Time info
        if (print["mc_remaining_time"].is<int>()) {
            _status.remainingSeconds = print["mc_remaining_time"].as<uint32_t>() * 60;  // Bambu sends minutes
        }

        // Layer info
        if (print["layer_num"].is<int>()) {
            _status.currentLayer = print["layer_num"].as<int>();
        }
        if (print["total_layer_num"].is<int>()) {
            _status.totalLayers = print["total_layer_num"].as<int>();
        }

        // Current filename
        if (print["gcode_file"].is<const char*>()) {
            _status.filename = print["gcode_file"].as<String>();
        }
    }

    // Update timestamp
    _status.lastUpdateMs = millis();
}

uint32_t BambuClient::getNextSequenceId() {
    return ++_sequenceId;
}

bool BambuClient::sendCommand(const char* commandType, JsonDocument& commandData) {
    if (!isConnected()) {
        DEBUG_PRINTF("[Bambu:%s] Cannot send command - not connected\n", _id.c_str());
        return false;
    }

    // Build command envelope
    JsonDocument envelope;
    envelope[commandType] = commandData;

    // Serialize to string
    String payload;
    serializeJson(envelope, payload);

    DEBUG_PRINTF("[Bambu:%s] Sending: %s\n", _id.c_str(), payload.c_str());

    // Publish to request topic
    bool success = _mqttClient->publish(_requestTopic.c_str(), payload.c_str());

    if (!success) {
        DEBUG_PRINTF("[Bambu:%s] Failed to publish command\n", _id.c_str());
    }

    return success;
}

// ========== Control Commands (stubs for MVP) ==========

bool BambuClient::pause() {
    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "pause";
    return sendCommand("print", cmd);
}

bool BambuClient::resume() {
    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "resume";
    return sendCommand("print", cmd);
}

bool BambuClient::stop() {
    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "stop";
    return sendCommand("print", cmd);
}

bool BambuClient::sendGcode(const String& gcode) {
    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "gcode_line";
    cmd["param"] = gcode;
    return sendCommand("print", cmd);
}

bool BambuClient::setLight(bool on) {
    // Use MQTT ledctrl command (same format as ha-bambulab integration)
    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "ledctrl";
    cmd["led_node"] = "chamber_light";
    cmd["led_mode"] = on ? "on" : "off";
    cmd["led_on_time"] = 500;
    cmd["led_off_time"] = 500;
    cmd["loop_times"] = 0;
    cmd["interval_time"] = 0;

    DEBUG_PRINTF("[Bambu:%s] Setting light %s\n", _id.c_str(), on ? "ON" : "OFF");
    return sendCommand("system", cmd);
}

void BambuClient::requestPushAll() {
    if (!isConnected()) {
        return;
    }

    JsonDocument cmd;
    cmd["sequence_id"] = String(getNextSequenceId());
    cmd["command"] = "pushall";

    DEBUG_PRINTF("[Bambu:%s] Requesting pushall\n", _id.c_str());
    sendCommand("pushing", cmd);
}

// ========== File Transfer (not implemented for MVP) ==========

bool BambuClient::uploadFile(Stream& source, const String& filename, size_t fileSize) {
    // FTPS implementation required - not part of MVP
    DEBUG_PRINTF("[Bambu:%s] uploadFile not implemented\n", _id.c_str());
    return false;
}

bool BambuClient::startPrint(const String& filename) {
    // Would send project_file command via MQTT after FTPS upload
    DEBUG_PRINTF("[Bambu:%s] startPrint not implemented\n", _id.c_str());
    return false;
}
