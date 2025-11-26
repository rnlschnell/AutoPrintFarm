#include "CredentialStore.h"
#include <esp_err.h>

const char* CredentialStore::NAMESPACE = "wifi";
const char* CredentialStore::KEY_SSID = "ssid";
const char* CredentialStore::KEY_PASSWORD = "password";
const char* CredentialStore::KEY_CONFIGURED = "configured";

CredentialStore::CredentialStore() {
}

bool CredentialStore::begin() {
    Serial.println("[CredentialStore] Initializing NVS...");

    // Initialize NVS flash storage
    esp_err_t err = nvs_flash_init();

    // If NVS partition was truncated or contains data in new format,
    // we need to erase it and reinitialize
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        Serial.println("[CredentialStore] NVS partition needs erase, reinitializing...");
        err = nvs_flash_erase();
        if (err != ESP_OK) {
            logNvsError(err, "nvs_flash_erase");
            return false;
        }
        err = nvs_flash_init();
    }

    if (err != ESP_OK && err != ESP_ERR_NVS_NO_FREE_PAGES) {
        // ESP_OK means success, already initialized is also fine
        if (err != ESP_OK) {
            logNvsError(err, "nvs_flash_init");
            // Don't return false - nvs_flash_init might return errors if already initialized
            // by PrinterConfigStore, but NVS should still work
        }
    }

    // Verify NVS is accessible by doing a test open/close
    Preferences testPrefs;
    bool testSuccess = false;
    for (int attempt = 0; attempt < CRED_NVS_RETRY_COUNT; attempt++) {
        if (testPrefs.begin("nvs_cred_test", false)) {
            testPrefs.end();
            testSuccess = true;
            break;
        }
        Serial.printf("[CredentialStore] NVS test open attempt %d failed, retrying...\n", attempt + 1);
        delay(CRED_NVS_RETRY_DELAY_MS);
    }

    if (!testSuccess) {
        Serial.println("[CredentialStore] Failed to verify NVS accessibility");
        return false;
    }

    _initialized = true;
    Serial.println("[CredentialStore] NVS initialized successfully");
    return true;
}

void CredentialStore::logNvsError(esp_err_t err, const char* operation) {
    const char* errName;
    switch (err) {
        case ESP_ERR_NVS_NOT_INITIALIZED:
            errName = "NVS_NOT_INITIALIZED";
            break;
        case ESP_ERR_NVS_NOT_FOUND:
            errName = "NVS_NOT_FOUND";
            break;
        case ESP_ERR_NVS_TYPE_MISMATCH:
            errName = "NVS_TYPE_MISMATCH";
            break;
        case ESP_ERR_NVS_READ_ONLY:
            errName = "NVS_READ_ONLY";
            break;
        case ESP_ERR_NVS_NOT_ENOUGH_SPACE:
            errName = "NVS_NOT_ENOUGH_SPACE";
            break;
        case ESP_ERR_NVS_INVALID_NAME:
            errName = "NVS_INVALID_NAME";
            break;
        case ESP_ERR_NVS_INVALID_HANDLE:
            errName = "NVS_INVALID_HANDLE";
            break;
        case ESP_ERR_NVS_INVALID_LENGTH:
            errName = "NVS_INVALID_LENGTH";
            break;
        case ESP_ERR_NVS_NO_FREE_PAGES:
            errName = "NVS_NO_FREE_PAGES";
            break;
        case ESP_ERR_NVS_NEW_VERSION_FOUND:
            errName = "NVS_NEW_VERSION_FOUND";
            break;
        case ESP_ERR_NVS_PART_NOT_FOUND:
            errName = "NVS_PART_NOT_FOUND";
            break;
        default:
            errName = "UNKNOWN";
            break;
    }
    Serial.printf("[CredentialStore] %s failed: %s (0x%x)\n", operation, errName, err);
}

bool CredentialStore::saveCredentials(const String& ssid, const String& password) {
    if (ssid.length() == 0 || ssid.length() > 32) {
        Serial.println("[CredentialStore] Invalid SSID length");
        return false;
    }
    if (password.length() > 64) {
        Serial.println("[CredentialStore] Password too long");
        return false;
    }

    // Warn if begin() wasn't called, but try anyway (for backward compatibility)
    if (!_initialized) {
        Serial.println("[CredentialStore] Warning: begin() not called, attempting save anyway...");
    }

    // Use retry mechanism for reliability
    for (int attempt = 1; attempt <= CRED_NVS_RETRY_COUNT; attempt++) {
        if (saveCredentialsWithRetry(ssid, password)) {
            Serial.printf("[CredentialStore] Saved credentials for SSID: %s (attempt %d)\n",
                          ssid.c_str(), attempt);
            return true;
        }

        if (attempt < CRED_NVS_RETRY_COUNT) {
            Serial.printf("[CredentialStore] Save attempt %d failed, retrying in %dms...\n",
                          attempt, CRED_NVS_RETRY_DELAY_MS);
            delay(CRED_NVS_RETRY_DELAY_MS);
        }
    }

    Serial.printf("[CredentialStore] Failed to save credentials after %d attempts\n",
                  CRED_NVS_RETRY_COUNT);
    return false;
}

bool CredentialStore::saveCredentialsWithRetry(const String& ssid, const String& password) {
    if (!_preferences.begin(NAMESPACE, false)) {
        Serial.println("[CredentialStore] Failed to open preferences namespace");
        return false;
    }

    bool success = true;

    // Write each field and track individual failures for debugging
    if (_preferences.putString(KEY_SSID, ssid) == 0 && ssid.length() > 0) {
        Serial.println("[CredentialStore] Failed to write KEY_SSID");
        success = false;
    }
    if (_preferences.putString(KEY_PASSWORD, password) == 0 && password.length() > 0) {
        Serial.println("[CredentialStore] Failed to write KEY_PASSWORD");
        success = false;
    }

    // Only set configured flag if all writes succeeded
    if (success) {
        if (_preferences.putBool(KEY_CONFIGURED, true) == 0) {
            Serial.println("[CredentialStore] Failed to write KEY_CONFIGURED");
            success = false;
        }
    }

    _preferences.end();
    return success;
}

bool CredentialStore::loadCredentials(String& ssid, String& password) {
    // Use read-write mode (false) to auto-create namespace if it doesn't exist
    if (!_preferences.begin(NAMESPACE, false)) {
        Serial.println("[CredentialStore] Failed to open preferences");
        return false;
    }

    bool configured = _preferences.getBool(KEY_CONFIGURED, false);
    if (!configured) {
        _preferences.end();
        Serial.println("[CredentialStore] No stored credentials found");
        return false;
    }

    ssid = _preferences.getString(KEY_SSID, "");
    password = _preferences.getString(KEY_PASSWORD, "");

    _preferences.end();

    if (ssid.length() == 0) {
        Serial.println("[CredentialStore] Stored SSID is empty");
        return false;
    }

    Serial.printf("[CredentialStore] Loaded credentials for SSID: %s\n", ssid.c_str());
    return true;
}

bool CredentialStore::hasCredentials() {
    // Use read-write mode (false) to auto-create namespace if it doesn't exist
    if (!_preferences.begin(NAMESPACE, false)) {
        return false;
    }
    bool configured = _preferences.getBool(KEY_CONFIGURED, false);
    String ssid = _preferences.getString(KEY_SSID, "");
    _preferences.end();

    return configured && ssid.length() > 0;
}

void CredentialStore::clearCredentials() {
    _preferences.begin(NAMESPACE, false);
    _preferences.clear();
    _preferences.end();

    Serial.println("[CredentialStore] Credentials cleared");
}

String CredentialStore::getStoredSSID() {
    // Use read-write mode (false) to auto-create namespace if it doesn't exist
    if (!_preferences.begin(NAMESPACE, false)) {
        return "";
    }
    String ssid = _preferences.getString(KEY_SSID, "");
    _preferences.end();
    return ssid;
}
