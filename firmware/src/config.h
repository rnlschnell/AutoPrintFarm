#ifndef CONFIG_H
#define CONFIG_H

// =============================================================================
// BLE Configuration
// =============================================================================

// Device name shown in BLE scan
#define BLE_DEVICE_NAME "AutoPrintFarm Hub"

// WiFi Provisioning Service UUID
#define SERVICE_UUID_WIFI_PROV "4fafc201-1fb5-459e-8fcc-c5c9c331914b"

// Characteristic UUIDs
#define CHAR_UUID_SSID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"  // Read/Write
#define CHAR_UUID_PASSWORD "beb5483f-36e1-4688-b7f5-ea07361b26a8"  // Write only
#define CHAR_UUID_COMMAND  "beb54840-36e1-4688-b7f5-ea07361b26a8"  // Write only
#define CHAR_UUID_STATUS   "beb54841-36e1-4688-b7f5-ea07361b26a8"  // Read/Notify
#define CHAR_UUID_HUB_ID   "beb54842-36e1-4688-b7f5-ea07361b26a8"  // Read/Write
#define CHAR_UUID_TENANT_ID "beb54843-36e1-4688-b7f5-ea07361b26a8" // Read/Write

// =============================================================================
// WiFi Configuration
// =============================================================================

// Connection timeout in milliseconds
#define WIFI_CONNECT_TIMEOUT_MS 15000

// Maximum credential lengths
#define MAX_SSID_LENGTH     32
#define MAX_PASSWORD_LENGTH 64

// =============================================================================
// NVS Configuration
// =============================================================================

#define NVS_NAMESPACE_WIFI "wifi_creds"
#define NVS_KEY_SSID       "ssid"
#define NVS_KEY_PASSWORD   "password"
#define NVS_KEY_VALID      "valid"

// Hub configuration NVS settings
#define NVS_NAMESPACE_HUB  "hub_config"
#define NVS_KEY_HUB_ID     "hub_id"
#define NVS_KEY_TENANT_ID  "tenant_id"
#define NVS_KEY_HUB_NAME   "hub_name"
#define NVS_KEY_HUB_VALID  "valid"

// Hub ID/Tenant ID max length (UUID = 36 chars)
#define MAX_HUB_ID_LENGTH    36
#define MAX_TENANT_ID_LENGTH 36
#define MAX_HUB_NAME_LENGTH  100

// =============================================================================
// Command Values (written to Command characteristic)
// =============================================================================

#define CMD_CONNECT    0x01  // Connect to WiFi with stored credentials
#define CMD_DISCONNECT 0x02  // Disconnect from WiFi
#define CMD_CLEAR      0xFF  // Clear stored credentials

// =============================================================================
// Status Values (read from Status characteristic)
// =============================================================================

#define STATUS_IDLE           0x00  // Not connected, no operation in progress
#define STATUS_CONNECTING     0x01  // WiFi connection in progress
#define STATUS_CONNECTED      0x02  // Successfully connected to WiFi
#define STATUS_FAILED         0x03  // Connection failed
#define STATUS_DISCONNECTED   0x04  // Explicitly disconnected
#define STATUS_NO_CREDENTIALS 0x05  // No SSID/password stored

// =============================================================================
// Cloud WebSocket Configuration
// =============================================================================

// WebSocket endpoint (development)
// NOTE: Use your computer's LAN IP, not localhost (ESP32 can't reach 127.0.0.1)
#define CLOUD_WS_HOST "192.168.4.22"
#define CLOUD_WS_PORT 8787
#define CLOUD_WS_PATH "/ws/hub/"
#define CLOUD_USE_SSL false  // Use true for wss://, false for ws://

// Production URL (uncomment for deployment)
// #define CLOUD_WS_HOST "api.printfarm.io"
// #define CLOUD_WS_PORT 443
// #define CLOUD_WS_PATH "/ws/hub/"
// #define CLOUD_USE_SSL true

// Authentication timeout (must send hub_hello within this time)
#define CLOUD_AUTH_TIMEOUT_MS 10000

// Heartbeat configuration
#define CLOUD_PING_INTERVAL_MS 25000   // Send ping every 25 seconds
#define CLOUD_PONG_TIMEOUT_MS  60000   // Disconnect if no pong within 60 seconds

// Reconnection configuration
#define CLOUD_RECONNECT_INITIAL_MS 1000    // Initial reconnect delay (1 second)
#define CLOUD_RECONNECT_MAX_MS     60000   // Maximum reconnect delay (1 minute)
#define CLOUD_MAX_RECONNECT_ATTEMPTS 20    // Max attempts before FAILED state
#define CLOUD_FAILED_RESET_MS      300000  // Reset FAILED state after 5 minutes

// Firmware version sent in hub_hello
#define FIRMWARE_VERSION "1.0.0"
#define HARDWARE_VERSION "ESP32-S3"

#endif // CONFIG_H
