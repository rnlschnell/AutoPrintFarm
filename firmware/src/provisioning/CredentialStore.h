#ifndef CREDENTIAL_STORE_H
#define CREDENTIAL_STORE_H

#include <Arduino.h>
#include <Preferences.h>

/**
 * CredentialStore - NVS-based storage for WiFi credentials
 *
 * Stores SSID and password securely in ESP32's non-volatile storage.
 * Credentials persist across reboots and power cycles.
 */
class CredentialStore {
public:
    CredentialStore();

    /**
     * Initialize the credential store
     * Must be called before any other methods
     * @return true if initialization successful
     */
    bool begin();

    /**
     * Save WiFi credentials to NVS
     * @param ssid WiFi network name (max 32 chars)
     * @param password WiFi password (max 64 chars)
     * @return true if saved successfully
     */
    bool saveCredentials(const String& ssid, const String& password);

    /**
     * Load stored credentials from NVS
     * @param ssid Output: stored SSID
     * @param password Output: stored password
     * @return true if credentials exist and were loaded
     */
    bool loadCredentials(String& ssid, String& password);

    /**
     * Check if valid credentials are stored
     * @return true if credentials exist
     */
    bool hasCredentials();

    /**
     * Clear all stored credentials
     */
    void clearCredentials();

    /**
     * Get the stored SSID (for display purposes)
     * @return stored SSID or empty string if none
     */
    String getStoredSSID();

private:
    Preferences _preferences;
    bool _initialized;
};

#endif // CREDENTIAL_STORE_H
