#include "PrinterConfigStore.h"

PrinterConfigStore::PrinterConfigStore() : _initialized(false) {
}

bool PrinterConfigStore::begin() {
    if (_initialized) {
        return true;
    }

    // Open NVS namespace in read-write mode
    bool success = _preferences.begin(NVS_NAMESPACE_PRINTERS, false);
    if (!success) {
        Serial.println("[PrinterConfigStore] Failed to open NVS namespace");
        return false;
    }

    _initialized = true;
    Serial.println("[PrinterConfigStore] Initialized");

    // Log current state
    uint8_t count = getActivePrinterCount();
    Serial.printf("[PrinterConfigStore] Found %d stored printer(s)\n", count);

    return true;
}

String PrinterConfigStore::getKeyForSlot(uint8_t slot) {
    return String(NVS_KEY_PRINTER_PREFIX) + String(slot);
}

bool PrinterConfigStore::savePrinter(uint8_t slot, const PrinterConfig& config) {
    if (!_initialized) {
        Serial.println("[PrinterConfigStore] Not initialized");
        return false;
    }

    if (slot >= MAX_PRINTERS) {
        Serial.printf("[PrinterConfigStore] Invalid slot: %d\n", slot);
        return false;
    }

    // Validate required fields
    if (strlen(config.serial_number) == 0) {
        Serial.println("[PrinterConfigStore] Serial number is required");
        return false;
    }

    if (strlen(config.ip_address) == 0) {
        Serial.println("[PrinterConfigStore] IP address is required");
        return false;
    }

    // Serialize config to bytes
    String key = getKeyForSlot(slot);
    size_t written = _preferences.putBytes(key.c_str(), &config, sizeof(PrinterConfig));

    if (written != sizeof(PrinterConfig)) {
        Serial.printf("[PrinterConfigStore] Failed to write printer %d\n", slot);
        return false;
    }

    Serial.printf("[PrinterConfigStore] Saved printer %d: %s @ %s\n",
                  slot, config.serial_number, config.ip_address);
    return true;
}

bool PrinterConfigStore::loadPrinter(uint8_t slot, PrinterConfig& config) {
    if (!_initialized) {
        Serial.println("[PrinterConfigStore] Not initialized");
        return false;
    }

    if (slot >= MAX_PRINTERS) {
        Serial.printf("[PrinterConfigStore] Invalid slot: %d\n", slot);
        return false;
    }

    String key = getKeyForSlot(slot);
    size_t read = _preferences.getBytes(key.c_str(), &config, sizeof(PrinterConfig));

    if (read != sizeof(PrinterConfig)) {
        // No data in this slot
        memset(&config, 0, sizeof(PrinterConfig));
        return false;
    }

    // Check if this slot is marked as active
    if (!config.active) {
        return false;
    }

    return true;
}

bool PrinterConfigStore::removePrinter(uint8_t slot) {
    if (!_initialized) {
        Serial.println("[PrinterConfigStore] Not initialized");
        return false;
    }

    if (slot >= MAX_PRINTERS) {
        Serial.printf("[PrinterConfigStore] Invalid slot: %d\n", slot);
        return false;
    }

    // Load current config to get serial for logging
    PrinterConfig config;
    bool hadConfig = loadPrinter(slot, config);

    // Remove the key
    String key = getKeyForSlot(slot);
    bool success = _preferences.remove(key.c_str());

    if (success && hadConfig) {
        Serial.printf("[PrinterConfigStore] Removed printer %d: %s\n",
                      slot, config.serial_number);
    }

    return success;
}

uint8_t PrinterConfigStore::getActivePrinterCount() {
    if (!_initialized) {
        return 0;
    }

    uint8_t count = 0;
    PrinterConfig config;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (loadPrinter(i, config)) {
            count++;
        }
    }

    return count;
}

int8_t PrinterConfigStore::findPrinterBySerial(const char* serial) {
    if (!_initialized || serial == nullptr || strlen(serial) == 0) {
        return -1;
    }

    PrinterConfig config;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (loadPrinter(i, config)) {
            if (strcmp(config.serial_number, serial) == 0) {
                return i;
            }
        }
    }

    return -1;
}

int8_t PrinterConfigStore::findEmptySlot() {
    if (!_initialized) {
        return -1;
    }

    PrinterConfig config;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        String key = getKeyForSlot(i);
        size_t read = _preferences.getBytes(key.c_str(), &config, sizeof(PrinterConfig));

        // Slot is empty if no data or not active
        if (read != sizeof(PrinterConfig) || !config.active) {
            return i;
        }
    }

    return -1;  // All slots full
}

uint8_t PrinterConfigStore::loadAllPrinters(PrinterConfig configs[MAX_PRINTERS]) {
    if (!_initialized) {
        return 0;
    }

    uint8_t count = 0;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (loadPrinter(i, configs[i])) {
            count++;
        } else {
            // Clear the slot in the output array
            memset(&configs[i], 0, sizeof(PrinterConfig));
        }
    }

    return count;
}

void PrinterConfigStore::clearAll() {
    if (!_initialized) {
        return;
    }

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        String key = getKeyForSlot(i);
        _preferences.remove(key.c_str());
    }

    Serial.println("[PrinterConfigStore] All printer configurations cleared");
}
