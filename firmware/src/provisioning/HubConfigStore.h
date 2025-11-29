#ifndef HUB_CONFIG_STORE_H
#define HUB_CONFIG_STORE_H

#include <Arduino.h>
#include <Preferences.h>

/**
 * HubConfigStore - NVS-based storage for hub registration config
 *
 * Stores Hub ID and Tenant ID in ESP32's non-volatile storage.
 * These values persist across reboots and identify the hub to the cloud.
 */
class HubConfigStore {
public:
    HubConfigStore();

    /**
     * Initialize the hub config store
     * Must be called before any other methods
     * @return true if initialization successful
     */
    bool begin();

    /**
     * Save hub configuration to NVS
     * @param hubId Hub ID (UUID, max 36 chars)
     * @param tenantId Tenant ID (UUID, max 36 chars)
     * @return true if saved successfully
     */
    bool saveHubConfig(const String& hubId, const String& tenantId);

    /**
     * Load stored hub config from NVS
     * @param hubId Output: stored Hub ID
     * @param tenantId Output: stored Tenant ID
     * @return true if config exists and was loaded
     */
    bool loadHubConfig(String& hubId, String& tenantId);

    /**
     * Check if valid hub config is stored
     * @return true if hub config exists
     */
    bool hasHubConfig();

    /**
     * Clear all stored hub config
     */
    void clearHubConfig();

    /**
     * Get the stored Hub ID
     * @return stored Hub ID or empty string if none
     */
    String getStoredHubId();

    /**
     * Get the stored Tenant ID
     * @return stored Tenant ID or empty string if none
     */
    String getStoredTenantId();

    /**
     * Save hub name to NVS
     * @param name Hub name (max 100 chars)
     * @return true if saved successfully
     */
    bool saveHubName(const String& name);

    /**
     * Get the stored hub name
     * @return stored hub name or empty string if none
     */
    String getStoredHubName();

private:
    Preferences _preferences;
    bool _initialized;
};

#endif // HUB_CONFIG_STORE_H
