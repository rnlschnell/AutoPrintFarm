#ifndef BAMBU_MQTT_CLIENT_H
#define BAMBU_MQTT_CLIENT_H

#include <Arduino.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>
#include "PrinterConfigStore.h"
#include "../config.h"

/**
 * PrinterStatus - Status data received from a Bambu printer
 */
struct PrinterStatus {
    char serial_number[MAX_SERIAL_NUMBER_LENGTH];
    char status[16];           // idle, printing, paused, error, offline
    float nozzle_temp;
    float nozzle_target;
    float bed_temp;
    float bed_target;
    float chamber_temp;
    int progress_percent;
    int current_layer;
    int total_layers;
    int remaining_time_seconds;
    bool is_connected;
};

/**
 * Callback signature for printer status updates
 */
typedef void (*PrinterStatusCallback)(const PrinterStatus& status);

/**
 * PrinterConnection - Internal state for a single printer connection
 */
struct PrinterConnection {
    WiFiClientSecure wifiClient;
    MQTTClient mqttClient{4096};  // Bambu sends large JSON messages, need 4KB buffer
    PrinterConfig config;
    bool connected;
    unsigned long lastReconnectAttempt;
    unsigned long lastStatusBroadcast;
    unsigned long lastPushAll;
    PrinterStatus lastStatus;
};

/**
 * BambuMqttClient - Manages MQTT connections to Bambu Lab printers
 *
 * Connects to up to MAX_PRINTERS Bambu Lab printers via MQTT over TLS,
 * receives status updates, and forwards temperature/status data via callbacks.
 */
class BambuMqttClient {
public:
    BambuMqttClient();

    /**
     * Initialize the MQTT client
     * Loads saved printer configs from NVS and initiates connections
     */
    void begin();

    /**
     * Poll all printer connections
     * Must be called regularly in the main loop
     */
    void poll();

    /**
     * Add a new printer configuration
     * @param config Printer configuration (id, serial, ip, access_code)
     * @return true if added successfully
     */
    bool addPrinter(const PrinterConfig& config);

    /**
     * Remove a printer by serial number
     * @param serialNumber Printer serial number
     * @return true if removed successfully
     */
    bool removePrinter(const char* serialNumber);

    /**
     * Update an existing printer configuration
     * @param config Updated printer configuration
     * @return true if updated successfully
     */
    bool updatePrinter(const PrinterConfig& config);

    /**
     * Set callback for printer status updates
     * @param callback Function to call when printer status changes
     */
    void setStatusCallback(PrinterStatusCallback callback);

    /**
     * Check if a specific printer is connected
     * @param serialNumber Printer serial number
     * @return true if connected
     */
    bool isPrinterConnected(const char* serialNumber);

    /**
     * Get count of currently connected printers
     * @return Number of connected printers
     */
    uint8_t getConnectedCount();

    /**
     * Get count of configured printers
     * @return Number of configured printers
     */
    uint8_t getConfiguredCount();

    /**
     * Control printer light
     * @param serialNumber Printer serial number
     * @param turnOn true to turn on, false to turn off
     * @return true if command sent successfully
     */
    bool setLight(const char* serialNumber, bool turnOn);

private:
    PrinterConnection _printers[MAX_PRINTERS];
    PrinterConfigStore _configStore;
    PrinterStatusCallback _statusCallback;

    /**
     * Connect to a printer in a specific slot
     */
    void connectPrinter(uint8_t slot);

    /**
     * Disconnect a printer in a specific slot
     */
    void disconnectPrinter(uint8_t slot);

    /**
     * Send pushall command to request full status from printer
     */
    void sendPushAll(uint8_t slot);

    /**
     * Handle incoming MQTT message for a printer
     */
    void handleMessage(uint8_t slot, String& topic, String& payload);

    /**
     * Parse Bambu status JSON and extract relevant fields
     */
    void parseStatusJson(uint8_t slot, const char* json);

    /**
     * Broadcast status update via callback (with throttling)
     */
    void broadcastStatus(uint8_t slot, bool force = false);

    /**
     * Static callback wrappers for MQTT library
     */
    static void onMessage0(String& topic, String& payload);
    static void onMessage1(String& topic, String& payload);
    static void onMessage2(String& topic, String& payload);
    static void onMessage3(String& topic, String& payload);
    static void onMessage4(String& topic, String& payload);

    /**
     * Static instance pointer for callbacks
     */
    static BambuMqttClient* _instance;
};

#endif // BAMBU_MQTT_CLIENT_H
