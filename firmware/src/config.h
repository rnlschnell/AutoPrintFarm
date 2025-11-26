#ifndef CONFIG_H
#define CONFIG_H

// =============================================================================
// Device Configuration
// =============================================================================

// Device name - used for BLE advertising and identification
#define DEVICE_NAME "AutoPrintFarm-Hub"

// =============================================================================
// BLE Provisioning Configuration
// =============================================================================

// Service and characteristic UUIDs are defined in BLEProvisioning.h
// These can be customized if needed

// BLE advertising interval (in 0.625ms units)
// Lower = faster discovery but more power, Higher = slower but less power
#define BLE_ADV_INTERVAL_MIN  0x20   // 20ms
#define BLE_ADV_INTERVAL_MAX  0x40   // 40ms

// =============================================================================
// WiFi Configuration
// =============================================================================

// Connection timeout in milliseconds
#define WIFI_CONNECT_TIMEOUT_MS  15000

// Reconnection attempts before giving up
#define WIFI_MAX_RECONNECT_ATTEMPTS  3

// =============================================================================
// Printer Configuration
// =============================================================================

// Maximum number of printers that can be configured
// Note: Also defined in PrinterConfigStore.h - keep in sync
#ifndef MAX_PRINTERS
#define MAX_PRINTERS 5
#endif

// Temperature logging interval (milliseconds)
#define TEMP_LOG_INTERVAL_MS 5000

// Bambu Lab specific settings
#define BAMBU_MQTT_PORT 8883
#define BAMBU_KEEPALIVE_SEC 30
#define BAMBU_RECONNECT_INTERVAL_MS 5000

// =============================================================================
// Cloud Tunnel Configuration
// =============================================================================

// Default cloud WebSocket URL
// For local development with wrangler dev, use your machine's IP:
#define CLOUD_DEFAULT_URL "ws://192.168.4.22:8788"
// For production:
// #define CLOUD_DEFAULT_URL "wss://cloud.autoprintfarm.com"

// Heartbeat/ping interval (ms) - send ping every 25 seconds
#define TUNNEL_PING_INTERVAL_MS 25000

// Heartbeat timeout (ms) - disconnect if no pong in 35 seconds
#define TUNNEL_PONG_TIMEOUT_MS 35000

// Authentication timeout (ms) - disconnect if no hub_welcome in 10 seconds
#define TUNNEL_AUTH_TIMEOUT_MS 10000

// Initial reconnect delay (ms)
#define TUNNEL_RECONNECT_INITIAL_MS 1000

// Maximum reconnect delay (ms)
#define TUNNEL_RECONNECT_MAX_MS 60000

// Maximum reconnect attempts before entering FAILED state
#define TUNNEL_MAX_RECONNECT_ATTEMPTS 10

// Status broadcast interval (ms) - send all printer statuses every 30 seconds
#define TUNNEL_STATUS_BROADCAST_MS 30000

// Firmware version - update with releases
#define FIRMWARE_VERSION "1.0.0"

// =============================================================================
// Debug Configuration
// =============================================================================

// Serial baud rate
#define SERIAL_BAUD_RATE  115200

// Enable verbose logging
#define DEBUG_ENABLED  1

#if DEBUG_ENABLED
    #define DEBUG_PRINT(x)    Serial.print(x)
    #define DEBUG_PRINTLN(x)  Serial.println(x)
    #define DEBUG_PRINTF(...) Serial.printf(__VA_ARGS__)
#else
    #define DEBUG_PRINT(x)
    #define DEBUG_PRINTLN(x)
    #define DEBUG_PRINTF(...)
#endif

#endif // CONFIG_H
