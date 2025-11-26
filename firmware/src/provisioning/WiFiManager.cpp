#include "WiFiManager.h"

WiFiManager::WiFiManager(CredentialStore& credentialStore)
    : _credentialStore(credentialStore)
    , _state(WiFiState::DISCONNECTED)
    , _stateCallback(nullptr)
    , _connectStartTime(0)
{
}

void WiFiManager::begin() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    Serial.println("[WiFiManager] Initialized in STA mode");
}

bool WiFiManager::connectWithStoredCredentials() {
    String ssid, password;
    if (!_credentialStore.loadCredentials(ssid, password)) {
        Serial.println("[WiFiManager] No stored credentials available");
        return false;
    }

    return connect(ssid, password, false);
}

bool WiFiManager::connect(const String& ssid, const String& password, bool saveOnSuccess) {
    if (ssid.length() == 0) {
        Serial.println("[WiFiManager] Cannot connect: SSID is empty");
        setState(WiFiState::FAILED);
        return false;
    }

    Serial.printf("[WiFiManager] Connecting to: %s\n", ssid.c_str());
    setState(WiFiState::CONNECTING);
    _connectStartTime = millis();

    WiFi.disconnect(true);
    delay(100);
    WiFi.begin(ssid.c_str(), password.c_str());

    // Wait for connection with timeout
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - _connectStartTime > CONNECT_TIMEOUT_MS) {
            Serial.println("[WiFiManager] Connection timeout");
            setState(WiFiState::FAILED);
            WiFi.disconnect(true);
            return false;
        }
        delay(100);
    }

    Serial.printf("[WiFiManager] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    setState(WiFiState::CONNECTED);

    if (saveOnSuccess) {
        _credentialStore.saveCredentials(ssid, password);
    }

    return true;
}

void WiFiManager::disconnect() {
    WiFi.disconnect(true);
    setState(WiFiState::DISCONNECTED);
    Serial.println("[WiFiManager] Disconnected");
}

void WiFiManager::clearStoredCredentials() {
    _credentialStore.clearCredentials();
}

String WiFiManager::scanNetworksJSON() {
    Serial.println("[WiFiManager] Scanning for networks...");

    // Perform scan
    int numNetworks = WiFi.scanNetworks();

    if (numNetworks < 0) {
        Serial.println("[WiFiManager] Scan failed");
        return "[]";
    }

    Serial.printf("[WiFiManager] Found %d networks\n", numNetworks);

    // Build JSON array
    JsonDocument doc;
    JsonArray networks = doc.to<JsonArray>();

    for (int i = 0; i < numNetworks; i++) {
        JsonObject network = networks.add<JsonObject>();
        network["ssid"] = WiFi.SSID(i);
        network["rssi"] = WiFi.RSSI(i);
        network["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;

        // Convert auth type to readable string
        switch (WiFi.encryptionType(i)) {
            case WIFI_AUTH_OPEN:
                network["auth"] = "OPEN";
                break;
            case WIFI_AUTH_WEP:
                network["auth"] = "WEP";
                break;
            case WIFI_AUTH_WPA_PSK:
                network["auth"] = "WPA";
                break;
            case WIFI_AUTH_WPA2_PSK:
                network["auth"] = "WPA2";
                break;
            case WIFI_AUTH_WPA_WPA2_PSK:
                network["auth"] = "WPA/WPA2";
                break;
            case WIFI_AUTH_WPA3_PSK:
                network["auth"] = "WPA3";
                break;
            default:
                network["auth"] = "UNKNOWN";
        }
    }

    // Clean up scan results
    WiFi.scanDelete();

    String result;
    serializeJson(doc, result);
    return result;
}

void WiFiManager::poll() {
    WiFiState currentState = _state;

    // Check for disconnection while we thought we were connected
    if (currentState == WiFiState::CONNECTED && WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFiManager] Lost connection");
        setState(WiFiState::DISCONNECTED);
    }
    // Check for reconnection
    else if (currentState == WiFiState::DISCONNECTED && WiFi.status() == WL_CONNECTED) {
        Serial.println("[WiFiManager] Reconnected");
        setState(WiFiState::CONNECTED);
    }
}

void WiFiManager::setState(WiFiState newState) {
    if (_state != newState) {
        _state = newState;
        if (_stateCallback) {
            _stateCallback(newState);
        }
    }
}
