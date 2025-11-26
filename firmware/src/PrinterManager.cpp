#include "PrinterManager.h"
#include "clients/BambuClient.h"
#include "config.h"

PrinterManager::PrinterManager(PrinterConfigStore& configStore)
    : _configStore(configStore)
    , _activeCount(0)
    , _lastTempLog(0)
{
    // Initialize all slots to nullptr
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        _printers[i] = nullptr;
    }
}

PrinterManager::~PrinterManager() {
    disconnectAll();

    // Clean up all printer instances
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i]) {
            delete _printers[i];
            _printers[i] = nullptr;
        }
    }
}

void PrinterManager::begin() {
    DEBUG_PRINTLN("[PrinterManager] Initialized");
}

void PrinterManager::loadPrinters() {
    DEBUG_PRINTLN("[PrinterManager] Loading printers from storage...");

    _activeCount = 0;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        // Clean up existing client if any
        if (_printers[i]) {
            delete _printers[i];
            _printers[i] = nullptr;
        }

        // Try to load config for this slot
        PrinterConfig config;
        if (_configStore.loadPrinter(i, config)) {
            _printers[i] = createClient(config);
            if (_printers[i]) {
                _activeCount++;
                DEBUG_PRINTF("[PrinterManager] Loaded slot %d: %s (%s)\n",
                             i, config.name.c_str(), config.type.c_str());
            }
        }
    }

    DEBUG_PRINTF("[PrinterManager] Loaded %d printer(s)\n", _activeCount);
}

PrinterClient* PrinterManager::createClient(const PrinterConfig& config) {
    if (config.type == "bambu") {
        return new BambuClient(
            config.id,
            config.name,
            config.ip,
            config.accessCode,
            config.serial
        );
    }

    // Future: Add other client types here
    // else if (config.type == "moonraker") {
    //     return new MoonrakerClient(...);
    // }
    // else if (config.type == "octoprint") {
    //     return new OctoPrintClient(...);
    // }
    // else if (config.type == "prusalink") {
    //     return new PrusaLinkClient(...);
    // }

    DEBUG_PRINTF("[PrinterManager] Unknown printer type: %s\n", config.type.c_str());
    return nullptr;
}

int8_t PrinterManager::addPrinter(const PrinterConfig& config) {
    // Find available slot
    int8_t slot = _configStore.findAvailableSlot();
    if (slot < 0) {
        DEBUG_PRINTLN("[PrinterManager] No available slots");
        return -1;
    }

    // Save to storage
    if (!_configStore.savePrinter(slot, config)) {
        DEBUG_PRINTLN("[PrinterManager] Failed to save printer config");
        return -1;
    }

    // Create client
    PrinterClient* client = createClient(config);
    if (!client) {
        _configStore.removePrinter(slot);
        return -1;
    }

    // Clean up existing client in slot (shouldn't happen but be safe)
    if (_printers[slot]) {
        delete _printers[slot];
    }

    _printers[slot] = client;
    _activeCount++;

    DEBUG_PRINTF("[PrinterManager] Added printer '%s' to slot %d\n",
                 config.name.c_str(), slot);

    // Auto-connect the new printer
    client->connect();

    return slot;
}

void PrinterManager::removePrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) return;

    if (_printers[slot]) {
        _printers[slot]->disconnect();
        delete _printers[slot];
        _printers[slot] = nullptr;
        _activeCount--;
    }

    _configStore.removePrinter(slot);

    DEBUG_PRINTF("[PrinterManager] Removed printer from slot %d\n", slot);
}

PrinterClient* PrinterManager::getPrinter(uint8_t slot) {
    if (slot >= MAX_PRINTERS) return nullptr;
    return _printers[slot];
}

bool PrinterManager::getPrinterStatus(uint8_t slot, PrinterStatus& status) {
    if (slot >= MAX_PRINTERS || !_printers[slot]) {
        return false;
    }

    status = _printers[slot]->getStatus();
    return true;
}

void PrinterManager::connectAll() {
    DEBUG_PRINTLN("[PrinterManager] Connecting all printers...");

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i]) {
            _printers[i]->connect();
        }
    }
}

void PrinterManager::disconnectAll() {
    DEBUG_PRINTLN("[PrinterManager] Disconnecting all printers...");

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i]) {
            _printers[i]->disconnect();
        }
    }
}

void PrinterManager::poll() {
    // Poll all active printers
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i]) {
            _printers[i]->poll();
        }
    }

    // Periodic temperature logging
    unsigned long now = millis();
    if (now - _lastTempLog >= TEMP_LOG_INTERVAL_MS) {
        _lastTempLog = now;
        logTemperatures();
    }
}

uint8_t PrinterManager::getConnectedCount() const {
    uint8_t count = 0;
    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i] && _printers[i]->isConnected()) {
            count++;
        }
    }
    return count;
}

bool PrinterManager::hasPrinter(uint8_t slot) const {
    return slot < MAX_PRINTERS && _printers[slot] != nullptr;
}

void PrinterManager::logTemperatures() {
    bool anyConnected = false;

    for (uint8_t i = 0; i < MAX_PRINTERS; i++) {
        if (_printers[i] && _printers[i]->isConnected()) {
            PrinterStatus status = _printers[i]->getStatus();

            Serial.printf("[%s] Nozzle: %.1f/%.1f°C  Bed: %.1f/%.1f°C  State: %s\n",
                          _printers[i]->getPrinterName().c_str(),
                          status.nozzleTemp, status.nozzleTarget,
                          status.bedTemp, status.bedTarget,
                          PrinterStatus::stateToString(status.state));

            anyConnected = true;
        }
    }

    if (!anyConnected && _activeCount > 0) {
        DEBUG_PRINTF("[PrinterManager] %d printer(s) configured, none connected\n", _activeCount);
    }
}
