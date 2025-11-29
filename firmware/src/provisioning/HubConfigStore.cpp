#include "HubConfigStore.h"
#include "../config.h"

HubConfigStore::HubConfigStore() : _initialized(false) {
}

bool HubConfigStore::begin() {
    if (_initialized) {
        return true;
    }

    // Open NVS namespace in read-write mode
    bool success = _preferences.begin(NVS_NAMESPACE_HUB, false);
    if (!success) {
        Serial.println("[HubConfigStore] Failed to open NVS namespace");
        return false;
    }

    _initialized = true;
    Serial.println("[HubConfigStore] Initialized");
    return true;
}

bool HubConfigStore::saveHubConfig(const String& hubId, const String& tenantId) {
    if (!_initialized) {
        Serial.println("[HubConfigStore] Not initialized");
        return false;
    }

    if (hubId.length() == 0 || hubId.length() > MAX_HUB_ID_LENGTH) {
        Serial.printf("[HubConfigStore] Invalid Hub ID length: %d\n", hubId.length());
        return false;
    }

    if (tenantId.length() == 0 || tenantId.length() > MAX_TENANT_ID_LENGTH) {
        Serial.printf("[HubConfigStore] Invalid Tenant ID length: %d\n", tenantId.length());
        return false;
    }

    // Store hub config
    size_t hubIdWritten = _preferences.putString(NVS_KEY_HUB_ID, hubId);
    size_t tenantIdWritten = _preferences.putString(NVS_KEY_TENANT_ID, tenantId);
    bool validWritten = _preferences.putBool(NVS_KEY_HUB_VALID, true);

    if (hubIdWritten == 0 || tenantIdWritten == 0 || !validWritten) {
        Serial.println("[HubConfigStore] Failed to write hub config");
        return false;
    }

    Serial.printf("[HubConfigStore] Saved hub config - Hub ID: %s, Tenant ID: %s\n",
                  hubId.c_str(), tenantId.c_str());
    return true;
}

bool HubConfigStore::loadHubConfig(String& hubId, String& tenantId) {
    if (!_initialized) {
        Serial.println("[HubConfigStore] Not initialized");
        return false;
    }

    // Check if config is valid
    bool valid = _preferences.getBool(NVS_KEY_HUB_VALID, false);
    if (!valid) {
        Serial.println("[HubConfigStore] No valid hub config stored");
        return false;
    }

    hubId = _preferences.getString(NVS_KEY_HUB_ID, "");
    tenantId = _preferences.getString(NVS_KEY_TENANT_ID, "");

    if (hubId.length() == 0 || tenantId.length() == 0) {
        Serial.println("[HubConfigStore] Stored hub config is incomplete");
        return false;
    }

    Serial.printf("[HubConfigStore] Loaded hub config - Hub ID: %s, Tenant ID: %s\n",
                  hubId.c_str(), tenantId.c_str());
    return true;
}

bool HubConfigStore::hasHubConfig() {
    if (!_initialized) {
        return false;
    }

    bool valid = _preferences.getBool(NVS_KEY_HUB_VALID, false);
    if (!valid) {
        return false;
    }

    String hubId = _preferences.getString(NVS_KEY_HUB_ID, "");
    String tenantId = _preferences.getString(NVS_KEY_TENANT_ID, "");
    return hubId.length() > 0 && tenantId.length() > 0;
}

void HubConfigStore::clearHubConfig() {
    if (!_initialized) {
        return;
    }

    _preferences.clear();
    Serial.println("[HubConfigStore] Hub config cleared");
}

String HubConfigStore::getStoredHubId() {
    if (!_initialized || !hasHubConfig()) {
        return "";
    }

    return _preferences.getString(NVS_KEY_HUB_ID, "");
}

String HubConfigStore::getStoredTenantId() {
    if (!_initialized || !hasHubConfig()) {
        return "";
    }

    return _preferences.getString(NVS_KEY_TENANT_ID, "");
}

bool HubConfigStore::saveHubName(const String& name) {
    if (!_initialized) {
        Serial.println("[HubConfigStore] Not initialized");
        return false;
    }

    if (name.length() > MAX_HUB_NAME_LENGTH) {
        Serial.printf("[HubConfigStore] Hub name too long: %d (max %d)\n", name.length(), MAX_HUB_NAME_LENGTH);
        return false;
    }

    size_t written = _preferences.putString(NVS_KEY_HUB_NAME, name);
    if (written == 0 && name.length() > 0) {
        Serial.println("[HubConfigStore] Failed to write hub name");
        return false;
    }

    Serial.printf("[HubConfigStore] Saved hub name: %s\n", name.c_str());
    return true;
}

String HubConfigStore::getStoredHubName() {
    if (!_initialized) {
        return "";
    }

    return _preferences.getString(NVS_KEY_HUB_NAME, "");
}
