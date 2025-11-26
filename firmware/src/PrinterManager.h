#ifndef PRINTER_MANAGER_H
#define PRINTER_MANAGER_H

#include <Arduino.h>
#include "PrinterClient.h"
#include "PrinterStatus.h"
#include "provisioning/PrinterConfigStore.h"

// Temperature logging interval (ms)
#define TEMP_LOG_INTERVAL_MS 5000

/**
 * Manages multiple printer connections.
 *
 * Responsibilities:
 * - Load printer configurations from NVS
 * - Create appropriate client instances (BambuClient, etc.)
 * - Orchestrate connection/disconnection
 * - Poll all printers in main loop
 * - Periodic temperature logging to serial
 */
class PrinterManager {
public:
    /**
     * Construct PrinterManager.
     * @param configStore Reference to printer config storage
     */
    PrinterManager(PrinterConfigStore& configStore);

    ~PrinterManager();

    /**
     * Initialize the manager.
     */
    void begin();

    /**
     * Load all configured printers from NVS and create clients.
     */
    void loadPrinters();

    /**
     * Add a printer dynamically and connect.
     * @param config Printer configuration
     * @return Slot index where printer was added, or -1 on failure
     */
    int8_t addPrinter(const PrinterConfig& config);

    /**
     * Remove a printer from a slot.
     * @param slot Slot index to remove
     */
    void removePrinter(uint8_t slot);

    /**
     * Get printer client by slot.
     * @param slot Slot index
     * @return PrinterClient pointer or nullptr
     */
    PrinterClient* getPrinter(uint8_t slot);

    /**
     * Get status of a specific printer.
     * @param slot Slot index
     * @param status Output status structure
     * @return true if printer exists and status was populated
     */
    bool getPrinterStatus(uint8_t slot, PrinterStatus& status);

    /**
     * Connect all loaded printers.
     */
    void connectAll();

    /**
     * Disconnect all printers.
     */
    void disconnectAll();

    /**
     * Must be called in main loop. Polls all printers and handles logging.
     */
    void poll();

    /**
     * Get count of active (loaded) printers.
     */
    uint8_t getActiveCount() const { return _activeCount; }

    /**
     * Get count of connected printers.
     */
    uint8_t getConnectedCount() const;

    /**
     * Check if a specific slot has a printer.
     */
    bool hasPrinter(uint8_t slot) const;

private:
    PrinterConfigStore& _configStore;
    PrinterClient* _printers[MAX_PRINTERS];
    uint8_t _activeCount = 0;

    // Temperature logging
    unsigned long _lastTempLog = 0;

    /**
     * Factory method to create appropriate client based on type.
     * @param config Printer configuration
     * @return New PrinterClient instance or nullptr
     */
    PrinterClient* createClient(const PrinterConfig& config);

    /**
     * Log temperatures of all connected printers.
     */
    void logTemperatures();
};

#endif // PRINTER_MANAGER_H
