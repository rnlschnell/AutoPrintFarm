#include "PrinterConfigStore.h"
#include <esp_err.h>

// NVS key names
static const char* KEY_VALID = "valid";
static const char* KEY_ID = "id";
static const char* KEY_TYPE = "type";
static const char* KEY_NAME = "name";
static const char* KEY_IP = "ip";
static const char* KEY_PORT = "port";
static const char* KEY_ACCESS_CODE = "access";
static const char* KEY_SERIAL = "serial";
static const char* KEY_API_KEY = "apikey";

PrinterConfigStore::PrinterConfigStore() {
}

bool PrinterConfigStore::begin() {
    Serial.println("[PrinterConfigStore] Initializing NVS...");

    // Initialize NVS flash storage
    esp_err_t err = nvs_flash_init();

    // If NVS partition was truncated or contains data in new format,
    // we need to erase it and reinitialize
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        Serial.println("[PrinterConfigStore] NVS partition needs erase, reinitializing...");
        err = nvs_flash_erase();
        if (err != ESP_OK) {
            logNvsError(err, "nvs_flash_erase");
            return false;
        }
        err = nvs_flash_init();
    }

    if (err != ESP_OK) {
        logNvsError(err, "nvs_flash_init");
        return false;
    }

    // Verify NVS is accessible by doing a test open/close
    Preferences testPrefs;
    bool testSuccess = false;
    for (int attempt = 0; attempt < NVS_RETRY_COUNT; attempt++) {
        if (testPrefs.begin("nvs_test", false)) {
            testPrefs.end();
            testSuccess = true;
            break;
        }
        Serial.printf("[PrinterConfigStore] NVS test open attempt %d failed, retrying...\n", attempt + 1);
        delay(NVS_RETRY_DELAY_MS);
    }

    if (!testSuccess) {
        Serial.println("[PrinterConfigStore] Failed to verify NVS accessibility");
        return false;
    }

    _initialized = true;
    Serial.println("[PrinterConfigStore] NVS initialized successfully");
    return true;
}

void PrinterConfigStore::logNvsError(esp_err_t err, const char* operation) {
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
    Serial.printf("[PrinterConfigStore] %s failed: %s (0x%x)\n", operation, errName, err);
}

String PrinterConfigStore::getNamespace(uint8_t slot) {
    return "printer" + String(slot);
}

bool PrinterConfigStore::savePrinter(uint8_t slot, const PrinterConfig& config) {
    if (slot >= MAX_PRINTERS) {
        Serial.printf("[PrinterConfigStore] Invalid slot: %d\n", slot);
        return false;
    }

    // Validate required fields
    if (config.type.length() == 0) {
        Serial.println("[PrinterConfigStore] Printer type is required");
        return false;
    }
    if (config.ip.length() == 0) {
        Serial.println("[PrinterConfigStore] Printer IP is required");
        return false;
    }

    // Warn if begin() wasn't called, but try anyway (for backward compatibility)
    if (!_initialized) {
        Serial.println("[PrinterConfigStore] Warning: begin() not called, attempting save anyway...");
    }

    // Use retry mechanism for reliability
    for (int attempt = 1; attempt <= NVS_RETRY_COUNT; attempt++) {
        if (savePrinterWithRetry(slot, config)) {
            Serial.printf("[PrinterConfigStore] Saved printer '%s' to slot %d (attempt %d)\n",
                          config.name.c_str(), slot, attempt);
            return true;
        }

        if (attempt < NVS_RETRY_COUNT) {
            Serial.printf("[PrinterConfigStore] Save attempt %d failed, retrying in %dms...\n",
                          attempt, NVS_RETRY_DELAY_MS);
            delay(NVS_RETRY_DELAY_MS);
        }
    }

    Serial.printf("[PrinterConfigStore] Failed to save printer to slot %d after %d attempts\n",
                  slot, NVS_RETRY_COUNT);
    return false;
}

bool PrinterConfigStore::savePrinterWithRetry(uint8_t slot, const PrinterConfig& config) {
    String ns = getNamespace(slot);

    if (!_preferences.begin(ns.c_str(), false)) {
        Serial.printf("[PrinterConfigStore] Failed to open namespace: %s\n", ns.c_str());
        return false;
    }

    bool success = true;

    // Write each field and track individual failures for debugging
    if (_preferences.putString(KEY_ID, config.id) == 0 && config.id.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_ID");
        success = false;
    }
    if (_preferences.putString(KEY_TYPE, config.type) == 0 && config.type.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_TYPE");
        success = false;
    }
    if (_preferences.putString(KEY_NAME, config.name) == 0 && config.name.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_NAME");
        success = false;
    }
    if (_preferences.putString(KEY_IP, config.ip) == 0 && config.ip.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_IP");
        success = false;
    }
    if (_preferences.putUShort(KEY_PORT, config.port) == 0 && config.port > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_PORT");
        success = false;
    }
    if (_preferences.putString(KEY_ACCESS_CODE, config.accessCode) == 0 && config.accessCode.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_ACCESS_CODE");
        success = false;
    }
    if (_preferences.putString(KEY_SERIAL, config.serial) == 0 && config.serial.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_SERIAL");
        success = false;
    }
    if (_preferences.putString(KEY_API_KEY, config.apiKey) == 0 && config.apiKey.length() > 0) {
        Serial.println("[PrinterConfigStore] Failed to write KEY_API_KEY");
        success = false;
    }

    // Only set valid flag if all writes succeeded
    if (success) {
        if (_preferences.putBool(KEY_VALID, true) == 0) {
            Serial.println("[PrinterConfigStore] Failed to write KEY_VALID");
            success = false;
        }
    }

    _preferences.end();
    return success;
}

bool PrinterConfigStore::loadPrinter(uint8_t slot, PrinterConfig& config) {
    if (slot >= MAX_PRINTERS) {
        return false;
    }

    String ns = getNamespace(slot);
    if (!_preferences.begin(ns.c_str(), false)) {
        return false;
    }

    bool valid = _preferences.getBool(KEY_VALID, false);
    if (!valid) {
        _preferences.end();
        return false;
    }

    config.valid = true;
    config.id = _preferences.getString(KEY_ID, "");
    config.type = _preferences.getString(KEY_TYPE, "");
    config.name = _preferences.getString(KEY_NAME, "");
    config.ip = _preferences.getString(KEY_IP, "");
    config.port = _preferences.getUShort(KEY_PORT, 0);
    config.accessCode = _preferences.getString(KEY_ACCESS_CODE, "");
    config.serial = _preferences.getString(KEY_SERIAL, "");
    config.apiKey = _preferences.getString(KEY_API_KEY, "");

    _preferences.end();

    // Generate ID if not set
    if (config.id.length() == 0) {
        config.id = config.type + "-" + String(slot);
    }

    Serial.printf("[PrinterConfigStore] Loaded printer '%s' from slot %d\n",
                  config.name.c_str(), slot);
    return true;
}

bool PrinterConfigStore::hasPrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) {
        return false;
    }

    String ns = getNamespace(slot);
    if (!_preferences.begin(ns.c_str(), false)) {
        return false;
    }

    bool valid = _preferences.getBool(KEY_VALID, false);
    _preferences.end();

    return valid;
}

void PrinterConfigStore::removePrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) {
        return;
    }

    String ns = getNamespace(slot);
    if (!_preferences.begin(ns.c_str(), false)) {
        return;
    }

    _preferences.clear();
    _preferences.end();

    Serial.printf("[PrinterConfigStore] Removed printer from slot %d\n", slot);
}

uint8_t PrinterConfigStore::getPrinterCount() {
    uint8_t count = 0;
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (hasPrinter(i)) {
            count++;
        }
    }
    return count;
}

void PrinterConfigStore::clearAll() {
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        removePrinter(i);
    }
    Serial.println("[PrinterConfigStore] All printer configurations cleared");
}

int8_t PrinterConfigStore::findAvailableSlot() {
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (!hasPrinter(i)) {
            return i;
        }
    }
    return -1;  // All slots full
}
