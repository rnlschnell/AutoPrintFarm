#include "TunnelConfigStore.h"
#include "../config.h"

// NVS namespace and keys
const char* TunnelConfigStore::NAMESPACE = "tunnel";
const char* TunnelConfigStore::KEY_HUB_ID = "hub_id";
const char* TunnelConfigStore::KEY_CLOUD_URL = "cloud_url";
const char* TunnelConfigStore::KEY_TENANT_ID = "tenant_id";
const char* TunnelConfigStore::KEY_CLAIM_TOKEN = "claim_token";
const char* TunnelConfigStore::KEY_REGISTERED = "registered";

TunnelConfigStore::TunnelConfigStore() {}

bool TunnelConfigStore::begin() {
    if (_initialized) {
        return true;
    }

    // Try to open NVS namespace with retry logic
    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.begin(NAMESPACE, false)) {
            _initialized = true;
            DEBUG_PRINTLN("[TunnelConfig] NVS initialized successfully");
            return true;
        }
        DEBUG_PRINTF("[TunnelConfig] NVS init attempt %d failed, retrying...\n", i + 1);
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to initialize NVS after retries");
    return false;
}

bool TunnelConfigStore::hasHubId() {
    if (!_initialized) return false;

    // Always return true since we can generate from MAC
    return true;
}

String TunnelConfigStore::getHubId() {
    if (!_initialized) {
        return generateHubId();
    }

    String hubId = _preferences.getString(KEY_HUB_ID, "");

    if (hubId.length() == 0) {
        // Generate from MAC address if not stored
        hubId = generateHubId();
        DEBUG_PRINTF("[TunnelConfig] Generated hub ID: %s\n", hubId.c_str());
    }

    return hubId;
}

bool TunnelConfigStore::setHubId(const String& hubId) {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return false;
    }

    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.putString(KEY_HUB_ID, hubId) > 0) {
            DEBUG_PRINTF("[TunnelConfig] Hub ID saved: %s\n", hubId.c_str());
            return true;
        }
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to save hub ID");
    return false;
}

String TunnelConfigStore::getCloudUrl() {
    if (!_initialized) {
        return CLOUD_DEFAULT_URL;
    }

    String url = _preferences.getString(KEY_CLOUD_URL, "");

    if (url.length() == 0) {
        return CLOUD_DEFAULT_URL;
    }

    return url;
}

bool TunnelConfigStore::setCloudUrl(const String& url) {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return false;
    }

    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.putString(KEY_CLOUD_URL, url) > 0) {
            DEBUG_PRINTF("[TunnelConfig] Cloud URL saved: %s\n", url.c_str());
            return true;
        }
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to save cloud URL");
    return false;
}

bool TunnelConfigStore::hasCustomCloudUrl() {
    if (!_initialized) return false;

    String url = _preferences.getString(KEY_CLOUD_URL, "");
    return url.length() > 0;
}

String TunnelConfigStore::getMacAddress() {
    uint8_t mac[6];
    WiFi.macAddress(mac);

    char macStr[13];
    snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    return String(macStr);
}

String TunnelConfigStore::generateHubId() {
    return "HUB-" + getMacAddress();
}

void TunnelConfigStore::reset() {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return;
    }

    _preferences.remove(KEY_HUB_ID);
    _preferences.remove(KEY_CLOUD_URL);
    _preferences.remove(KEY_TENANT_ID);
    _preferences.remove(KEY_CLAIM_TOKEN);
    _preferences.remove(KEY_REGISTERED);
    DEBUG_PRINTLN("[TunnelConfig] Configuration reset to defaults");
}

String TunnelConfigStore::getTenantId() {
    if (!_initialized) {
        return "";
    }

    return _preferences.getString(KEY_TENANT_ID, "");
}

bool TunnelConfigStore::setTenantId(const String& tenantId) {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return false;
    }

    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.putString(KEY_TENANT_ID, tenantId) > 0) {
            DEBUG_PRINTF("[TunnelConfig] Tenant ID saved: %s\n", tenantId.c_str());
            return true;
        }
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to save tenant ID");
    return false;
}

bool TunnelConfigStore::hasTenantId() {
    if (!_initialized) return false;

    String tenantId = _preferences.getString(KEY_TENANT_ID, "");
    return tenantId.length() > 0;
}

String TunnelConfigStore::getClaimToken() {
    if (!_initialized) {
        return "";
    }

    return _preferences.getString(KEY_CLAIM_TOKEN, "");
}

bool TunnelConfigStore::setClaimToken(const String& token) {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return false;
    }

    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.putString(KEY_CLAIM_TOKEN, token) > 0) {
            DEBUG_PRINTF("[TunnelConfig] Claim token saved (length: %d)\n", token.length());
            return true;
        }
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to save claim token");
    return false;
}

bool TunnelConfigStore::hasClaimToken() {
    if (!_initialized) return false;

    String token = _preferences.getString(KEY_CLAIM_TOKEN, "");
    return token.length() > 0;
}

bool TunnelConfigStore::isRegistered() {
    if (!_initialized) return false;

    return _preferences.getBool(KEY_REGISTERED, false);
}

bool TunnelConfigStore::setRegistered(bool registered) {
    if (!_initialized) {
        DEBUG_PRINTLN("[TunnelConfig] ERROR: NVS not initialized");
        return false;
    }

    for (int i = 0; i < TUNNEL_NVS_RETRY_COUNT; i++) {
        if (_preferences.putBool(KEY_REGISTERED, registered)) {
            DEBUG_PRINTF("[TunnelConfig] Registered status saved: %s\n", registered ? "true" : "false");
            return true;
        }
        delay(TUNNEL_NVS_RETRY_DELAY_MS);
    }

    DEBUG_PRINTLN("[TunnelConfig] ERROR: Failed to save registered status");
    return false;
}

bool TunnelConfigStore::setCloudConfig(const String& tenantId, const String& claimToken, const String& apiUrl) {
    DEBUG_PRINTLN("[TunnelConfig] Setting cloud config from BLE...");

    // Convert API URL to WebSocket URL
    // https://api.example.com -> wss://api.example.com
    // http://192.168.1.100:8788 -> ws://192.168.1.100:8788
    String wsUrl = apiUrl;
    if (wsUrl.startsWith("https://")) {
        wsUrl = "wss://" + wsUrl.substring(8);
    } else if (wsUrl.startsWith("http://")) {
        wsUrl = "ws://" + wsUrl.substring(7);
    }
    // If already ws:// or wss://, keep as is

    bool success = true;

    if (!setTenantId(tenantId)) {
        DEBUG_PRINTLN("[TunnelConfig] Failed to save tenant ID");
        success = false;
    }

    if (!setClaimToken(claimToken)) {
        DEBUG_PRINTLN("[TunnelConfig] Failed to save claim token");
        success = false;
    }

    if (!setCloudUrl(wsUrl)) {
        DEBUG_PRINTLN("[TunnelConfig] Failed to save cloud URL");
        success = false;
    }

    // Reset registered status since we have new config
    setRegistered(false);

    if (success) {
        DEBUG_PRINTLN("[TunnelConfig] Cloud config saved successfully");
    }

    return success;
}
