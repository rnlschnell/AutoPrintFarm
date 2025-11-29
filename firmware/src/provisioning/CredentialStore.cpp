#include "CredentialStore.h"
#include "../config.h"

CredentialStore::CredentialStore() : _initialized(false) {
}

bool CredentialStore::begin() {
    if (_initialized) {
        return true;
    }

    // Open NVS namespace in read-write mode
    bool success = _preferences.begin(NVS_NAMESPACE_WIFI, false);
    if (!success) {
        Serial.println("[CredentialStore] Failed to open NVS namespace");
        return false;
    }

    _initialized = true;
    Serial.println("[CredentialStore] Initialized");
    return true;
}

bool CredentialStore::saveCredentials(const String& ssid, const String& password) {
    if (!_initialized) {
        Serial.println("[CredentialStore] Not initialized");
        return false;
    }

    if (ssid.length() == 0 || ssid.length() > MAX_SSID_LENGTH) {
        Serial.printf("[CredentialStore] Invalid SSID length: %d\n", ssid.length());
        return false;
    }

    if (password.length() > MAX_PASSWORD_LENGTH) {
        Serial.printf("[CredentialStore] Password too long: %d\n", password.length());
        return false;
    }

    // Store credentials
    size_t ssidWritten = _preferences.putString(NVS_KEY_SSID, ssid);
    size_t passWritten = _preferences.putString(NVS_KEY_PASSWORD, password);
    bool validWritten = _preferences.putBool(NVS_KEY_VALID, true);

    if (ssidWritten == 0 || !validWritten) {
        Serial.println("[CredentialStore] Failed to write credentials");
        return false;
    }

    Serial.printf("[CredentialStore] Saved credentials for SSID: %s\n", ssid.c_str());
    return true;
}

bool CredentialStore::loadCredentials(String& ssid, String& password) {
    if (!_initialized) {
        Serial.println("[CredentialStore] Not initialized");
        return false;
    }

    // Check if credentials are valid
    bool valid = _preferences.getBool(NVS_KEY_VALID, false);
    if (!valid) {
        Serial.println("[CredentialStore] No valid credentials stored");
        return false;
    }

    ssid = _preferences.getString(NVS_KEY_SSID, "");
    password = _preferences.getString(NVS_KEY_PASSWORD, "");

    if (ssid.length() == 0) {
        Serial.println("[CredentialStore] Stored SSID is empty");
        return false;
    }

    Serial.printf("[CredentialStore] Loaded credentials for SSID: %s\n", ssid.c_str());
    return true;
}

bool CredentialStore::hasCredentials() {
    if (!_initialized) {
        return false;
    }

    bool valid = _preferences.getBool(NVS_KEY_VALID, false);
    if (!valid) {
        return false;
    }

    String ssid = _preferences.getString(NVS_KEY_SSID, "");
    return ssid.length() > 0;
}

void CredentialStore::clearCredentials() {
    if (!_initialized) {
        return;
    }

    _preferences.clear();
    Serial.println("[CredentialStore] Credentials cleared");
}

String CredentialStore::getStoredSSID() {
    if (!_initialized || !hasCredentials()) {
        return "";
    }

    return _preferences.getString(NVS_KEY_SSID, "");
}
