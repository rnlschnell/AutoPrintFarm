#ifndef TUNNEL_CONFIG_STORE_H
#define TUNNEL_CONFIG_STORE_H

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>

// Retry configuration for NVS operations
#define TUNNEL_NVS_RETRY_COUNT 3
#define TUNNEL_NVS_RETRY_DELAY_MS 100

/**
 * NVS storage for cloud tunnel configuration.
 * Stores hub identity, cloud WebSocket URL, tenant ID, and claim token.
 */
class TunnelConfigStore {
public:
    TunnelConfigStore();

    /**
     * Initialize NVS storage.
     * @return true if initialization successful
     */
    bool begin();

    /**
     * Check if NVS has been successfully initialized.
     */
    bool isInitialized() const { return _initialized; }

    /**
     * Check if hub ID is configured (either stored or can be generated).
     */
    bool hasHubId();

    /**
     * Get hub ID. If not stored, generates from MAC address.
     * Format: HUB-AABBCCDDEEFF
     */
    String getHubId();

    /**
     * Set custom hub ID.
     * @param hubId Hub identifier
     * @return true if saved successfully
     */
    bool setHubId(const String& hubId);

    /**
     * Get cloud WebSocket URL.
     * Returns default URL if not configured.
     */
    String getCloudUrl();

    /**
     * Set custom cloud URL.
     * @param url WebSocket URL (ws:// or wss://)
     * @return true if saved successfully
     */
    bool setCloudUrl(const String& url);

    /**
     * Check if a custom cloud URL is configured.
     */
    bool hasCustomCloudUrl();

    /**
     * Get tenant ID for hub claiming.
     * @return Tenant ID or empty string if not configured
     */
    String getTenantId();

    /**
     * Set tenant ID for hub claiming.
     * @param tenantId Tenant identifier
     * @return true if saved successfully
     */
    bool setTenantId(const String& tenantId);

    /**
     * Check if tenant ID is configured.
     */
    bool hasTenantId();

    /**
     * Get claim token for automatic hub claiming.
     * @return Claim token or empty string if not configured
     */
    String getClaimToken();

    /**
     * Set claim token for automatic hub claiming.
     * @param token Claim token from tenant settings
     * @return true if saved successfully
     */
    bool setClaimToken(const String& token);

    /**
     * Check if claim token is configured.
     */
    bool hasClaimToken();

    /**
     * Check if hub is registered (has been successfully registered with cloud).
     */
    bool isRegistered();

    /**
     * Mark hub as registered after successful cloud registration.
     * @param registered Registration status
     * @return true if saved successfully
     */
    bool setRegistered(bool registered);

    /**
     * Get the MAC address as a string (no colons).
     */
    String getMacAddress();

    /**
     * Reset all tunnel configuration to defaults.
     */
    void reset();

    /**
     * Set all cloud config at once (from BLE provisioning).
     * @param tenantId Tenant identifier
     * @param claimToken Claim token for auto-claiming
     * @param apiUrl Cloud API URL (will be converted to WebSocket URL)
     * @return true if all saved successfully
     */
    bool setCloudConfig(const String& tenantId, const String& claimToken, const String& apiUrl);

private:
    Preferences _preferences;
    bool _initialized = false;

    static const char* NAMESPACE;
    static const char* KEY_HUB_ID;
    static const char* KEY_CLOUD_URL;
    static const char* KEY_TENANT_ID;
    static const char* KEY_CLAIM_TOKEN;
    static const char* KEY_REGISTERED;

    /**
     * Generate hub ID from ESP32 MAC address.
     * Format: HUB-AABBCCDDEEFF
     */
    String generateHubId();
};

#endif // TUNNEL_CONFIG_STORE_H
