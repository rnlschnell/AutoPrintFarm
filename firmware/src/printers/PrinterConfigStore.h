#ifndef PRINTER_CONFIG_STORE_H
#define PRINTER_CONFIG_STORE_H

#include <Arduino.h>
#include <Preferences.h>
#include "../config.h"

/**
 * PrinterConfig - Configuration for a single printer
 */
struct PrinterConfig {
    char id[MAX_PRINTER_ID_LENGTH];                    // Cloud UUID
    char serial_number[MAX_SERIAL_NUMBER_LENGTH];      // Printer serial number
    char ip_address[MAX_IP_ADDRESS_LENGTH];            // Printer IP address
    char access_code[MAX_ACCESS_CODE_LENGTH];          // Access code for MQTT auth
    bool active;                                        // Whether this slot is in use
};

/**
 * PrinterConfigStore - NVS-based storage for printer configurations
 *
 * Stores up to MAX_PRINTERS printer configurations in ESP32's non-volatile storage.
 * Configurations persist across reboots and power cycles.
 */
class PrinterConfigStore {
public:
    PrinterConfigStore();

    /**
     * Initialize the printer config store
     * Must be called before any other methods
     * @return true if initialization successful
     */
    bool begin();

    /**
     * Save a printer configuration to a specific slot
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @param config Printer configuration to save
     * @return true if saved successfully
     */
    bool savePrinter(uint8_t slot, const PrinterConfig& config);

    /**
     * Load a printer configuration from a specific slot
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @param config Output: loaded configuration
     * @return true if slot contains valid config
     */
    bool loadPrinter(uint8_t slot, PrinterConfig& config);

    /**
     * Remove a printer from a specific slot
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @return true if removed successfully
     */
    bool removePrinter(uint8_t slot);

    /**
     * Get count of active printers
     * @return Number of printers with active=true
     */
    uint8_t getActivePrinterCount();

    /**
     * Find a printer by serial number
     * @param serial Serial number to search for
     * @return Slot index (0-4) or -1 if not found
     */
    int8_t findPrinterBySerial(const char* serial);

    /**
     * Find an empty slot for a new printer
     * @return Slot index (0-4) or -1 if all slots full
     */
    int8_t findEmptySlot();

    /**
     * Load all printer configurations into an array
     * @param configs Array of MAX_PRINTERS PrinterConfig structs
     * @return Number of active printers loaded
     */
    uint8_t loadAllPrinters(PrinterConfig configs[MAX_PRINTERS]);

    /**
     * Clear all stored printer configurations
     */
    void clearAll();

private:
    Preferences _preferences;
    bool _initialized;

    /**
     * Generate NVS key for a printer slot
     */
    String getKeyForSlot(uint8_t slot);
};

#endif // PRINTER_CONFIG_STORE_H
