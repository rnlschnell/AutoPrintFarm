#ifndef CREDENTIAL_STORE_H
#define CREDENTIAL_STORE_H

#include <Arduino.h>
#include <Preferences.h>
#include <nvs_flash.h>

// Retry configuration for NVS operations
#define CRED_NVS_RETRY_COUNT 3
#define CRED_NVS_RETRY_DELAY_MS 100

class CredentialStore {
public:
    CredentialStore();

    // Initialize NVS storage. Should be called early in setup().
    // Note: If PrinterConfigStore::begin() is called first, this will reuse that initialization.
    bool begin();

    // Check if NVS has been successfully initialized
    bool isInitialized() const { return _initialized; }

    // Save WiFi credentials to NVS (with retry logic)
    bool saveCredentials(const String& ssid, const String& password);

    // Load WiFi credentials from NVS
    bool loadCredentials(String& ssid, String& password);

    // Check if credentials exist
    bool hasCredentials();

    // Clear stored credentials
    void clearCredentials();

    // Get the stored SSID (without password)
    String getStoredSSID();

private:
    Preferences _preferences;
    bool _initialized = false;
    static const char* NAMESPACE;
    static const char* KEY_SSID;
    static const char* KEY_PASSWORD;
    static const char* KEY_CONFIGURED;

    // Internal save with retry logic
    bool saveCredentialsWithRetry(const String& ssid, const String& password);

    // Log NVS error codes for debugging
    void logNvsError(esp_err_t err, const char* operation);
};

#endif // CREDENTIAL_STORE_H
