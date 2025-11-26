#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include "CredentialStore.h"

enum class WiFiState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    FAILED
};

class WiFiManager {
public:
    WiFiManager(CredentialStore& credentialStore);

    // Initialize WiFi (call in setup)
    void begin();

    // Attempt connection with stored credentials
    bool connectWithStoredCredentials();

    // Attempt connection with provided credentials
    bool connect(const String& ssid, const String& password, bool saveOnSuccess = true);

    // Disconnect from WiFi
    void disconnect();

    // Scan for available networks and return as JSON
    String scanNetworksJSON();

    // Get current state
    WiFiState getState() const { return _state; }

    // Check if connected
    bool isConnected() const { return WiFi.status() == WL_CONNECTED; }

    // Get current SSID
    String getCurrentSSID() const { return WiFi.SSID(); }

    // Get IP address
    String getIPAddress() const { return WiFi.localIP().toString(); }

    // Get RSSI (signal strength)
    int getRSSI() const { return WiFi.RSSI(); }

    // Clear stored credentials
    void clearStoredCredentials();

    // Poll for connection state changes (call in loop)
    void poll();

    // Set callback for state changes
    typedef void (*StateChangeCallback)(WiFiState newState);
    void setStateChangeCallback(StateChangeCallback callback) { _stateCallback = callback; }

private:
    CredentialStore& _credentialStore;
    WiFiState _state;
    StateChangeCallback _stateCallback;
    unsigned long _connectStartTime;
    static const unsigned long CONNECT_TIMEOUT_MS = 15000;

    void setState(WiFiState newState);
};

#endif // WIFI_MANAGER_H
