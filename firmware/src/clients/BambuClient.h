#ifndef BAMBU_CLIENT_H
#define BAMBU_CLIENT_H

#include <Arduino.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <map>
#include "../PrinterClient.h"
#include "../PrinterStatus.h"

// Bambu MQTT port (TLS)
#define BAMBU_MQTT_PORT 8883

// MQTT keepalive in seconds (Bambu drops after ~60s inactivity)
#define BAMBU_KEEPALIVE_SEC 30

// Reconnection attempt interval (ms)
#define BAMBU_RECONNECT_INTERVAL_MS 5000

/**
 * Bambu Lab printer client using MQTT over TLS.
 *
 * Protocol details:
 * - Port: 8883 (MQTT over TLS)
 * - Auth: Username "bblp", Password = LAN Access Code
 * - Topics:
 *   - Subscribe: device/{serial}/report (status updates)
 *   - Publish: device/{serial}/request (commands)
 */
class BambuClient : public PrinterClient {
public:
    /**
     * Construct a BambuClient.
     * @param id Unique identifier for this printer
     * @param name User-friendly display name
     * @param ip Printer IP address
     * @param accessCode LAN access code (8 digits from printer screen)
     * @param serial Printer serial number (15 characters)
     */
    BambuClient(const String& id, const String& name,
                const String& ip, const String& accessCode,
                const String& serial);

    ~BambuClient() override;

    // PrinterClient interface implementation
    bool connect() override;
    void disconnect() override;
    bool isConnected() override;

    PrinterStatus getStatus() override;
    void poll() override;

    bool pause() override;
    bool resume() override;
    bool stop() override;
    bool sendGcode(const String& gcode) override;
    bool setLight(bool on) override;

    // Request full status update from printer
    void requestPushAll();

    bool uploadFile(Stream& source, const String& filename, size_t fileSize) override;
    bool startPrint(const String& filename) override;

    String getPrinterType() override { return "bambu"; }
    String getPrinterName() override { return _name; }
    String getPrinterId() override { return _id; }

private:
    // Configuration
    String _id;
    String _name;
    String _ip;
    String _accessCode;
    String _serial;

    // MQTT components
    WiFiClientSecure* _wifiClient;
    PubSubClient* _mqttClient;

    // Status
    PrinterStatus _status;
    unsigned long _lastReconnectAttempt = 0;
    uint32_t _sequenceId = 0;

    // MQTT topic strings
    String _reportTopic;   // device/{serial}/report
    String _requestTopic;  // device/{serial}/request

    // Initialize MQTT client
    void setupMQTT();

    // Attempt MQTT reconnection
    bool reconnect();

    // Parse incoming status message
    void handleMessage(const char* payload, size_t length);

    // Send a command to the printer
    bool sendCommand(const char* commandType, JsonDocument& commandData);

    // Get next sequence ID
    uint32_t getNextSequenceId();

    // Static callback system for routing MQTT messages to correct instance
    static std::map<String, BambuClient*> _instanceMap;
    static void mqttCallbackStatic(char* topic, byte* payload, unsigned int length);
    void registerInstance();
    void unregisterInstance();
};

#endif // BAMBU_CLIENT_H
