#ifndef PRINTER_CONFIG_STORE_H
#define PRINTER_CONFIG_STORE_H

#include <Arduino.h>
#include <Preferences.h>
#include <nvs_flash.h>

// Retry configuration for NVS operations
#define NVS_RETRY_COUNT 3
#define NVS_RETRY_DELAY_MS 100

// Maximum number of printers supported
#define MAX_PRINTERS 5

// Printer configuration structure
struct PrinterConfig {
    bool valid = false;
    String id;              // Unique identifier (e.g., "bambu-1")
    String type;            // "bambu", "moonraker", "octoprint", "prusalink"
    String name;            // User-friendly name
    String ip;              // IP address
    uint16_t port = 0;      // Port (default varies by protocol)
    String accessCode;      // Bambu: LAN access code (8 digits)
    String serial;          // Bambu: printer serial number (15 chars)
    String apiKey;          // OctoPrint/Moonraker API key
};

/**
 * NVS-based storage for printer configurations.
 * Uses per-slot namespaces (printer0, printer1, etc.) to store up to 5 printers.
 */
class PrinterConfigStore {
public:
    PrinterConfigStore();

    /**
     * Initialize NVS storage. Must be called before any other operations.
     * Should be called early in setup() before using savePrinter/loadPrinter.
     * @return true if NVS is ready for use
     */
    bool begin();

    /**
     * Check if NVS has been successfully initialized.
     * @return true if begin() was called and succeeded
     */
    bool isInitialized() const { return _initialized; }

    /**
     * Save a printer configuration to a slot.
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @param config PrinterConfig to save
     * @return true if saved successfully
     */
    bool savePrinter(uint8_t slot, const PrinterConfig& config);

    /**
     * Load a printer configuration from a slot.
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @param config PrinterConfig to populate
     * @return true if loaded successfully
     */
    bool loadPrinter(uint8_t slot, PrinterConfig& config);

    /**
     * Check if a slot has a valid printer configuration.
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     * @return true if slot has valid config
     */
    bool hasPrinter(uint8_t slot);

    /**
     * Remove a printer from a slot.
     * @param slot Slot index (0 to MAX_PRINTERS-1)
     */
    void removePrinter(uint8_t slot);

    /**
     * Get count of configured printers.
     * @return Number of valid printer configs
     */
    uint8_t getPrinterCount();

    /**
     * Clear all printer configurations.
     */
    void clearAll();

    /**
     * Find the next available slot.
     * @return Slot index, or -1 if all slots are full
     */
    int8_t findAvailableSlot();

private:
    Preferences _preferences;
    bool _initialized = false;

    // Get namespace for a slot (e.g., "printer0", "printer1")
    String getNamespace(uint8_t slot);

    // Internal save with retry logic
    bool savePrinterWithRetry(uint8_t slot, const PrinterConfig& config);

    // Log NVS error codes for debugging
    void logNvsError(esp_err_t err, const char* operation);
};

#endif // PRINTER_CONFIG_STORE_H
