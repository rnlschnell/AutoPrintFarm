# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AutoPrintFarm-Hub** is an ESP32-S3 based universal 3D printer controller designed to replace the Raspberry Pi in the PrintFarmSoftware architecture. The device connects directly to 3D printers using their native protocols, providing a lightweight, low-power, always-on printer management solution.

### Target Hardware
- **MCU**: ESP32-S3-WROOM-1 N16R8
  - Dual-core Xtensa LX7 @ 240MHz
  - 512KB internal SRAM + 8MB PSRAM
  - 16MB Flash
  - WiFi, Bluetooth 5.0

### Development Board Notes
- **USB-to-Serial**: The development board uses a **CH343 USB-to-Serial converter chip** (VID:PID=1A86:55D3), NOT native USB CDC
- **Serial Output**: Regular `Serial` on UART0 works correctly - no USB CDC build flags needed
- **COM Port**: Appears as "USB-Enhanced-SERIAL CH343" in device manager
- Do NOT add `-DARDUINO_USB_CDC_ON_BOOT=1` or `-DARDUINO_USB_MODE` flags - these are only for boards with native USB connection

### Project Goals
1. **Universal printer connectivity** - Support the vast majority of consumer/prosumer 3D printers
2. **Lightweight footprint** - Replace RPi with low-power ESP32 for printer control
3. **Protocol abstraction** - Unified interface regardless of printer brand/protocol
4. **Cloud tunnel** - Bidirectional connection to dashboard for remote monitoring and control
5. **File transfer relay** - Stream print files from cloud to printers without local storage

## Supported Printer Protocols

### 1. Bambu Lab (MQTT over TLS + FTPS)
- **Printers**: X1C, X1E, P1S, P1P, A1, A1 Mini
- **Requirements**: LAN-only mode with Developer Mode enabled
- **Status/Control Protocol**: MQTT with TLS encryption
  - **Port**: 8883
  - **Auth**: Username `bblp`, Password = LAN Access Code
  - **Topics**:
    - Subscribe: `device/{serial}/report` (status updates)
    - Publish: `device/{serial}/request` (commands)
  - **Message Format**: JSON with structure `{"{TYPE}": {"sequence_id": "0", "command": "{CMD}", ...}}`
- **File Transfer Protocol**: FTPS (implicit TLS)
  - **Port**: 990
  - **Auth**: Username `bblp`, Password = LAN Access Code
  - **Usage**: Upload 3MF files, then trigger print via MQTT command

### 2. Moonraker/Klipper (HTTP + WebSocket)
- **Printers**: Creality K1/K1 Max, Voron, RatRig, any Klipper-based printer
- **Protocol**: HTTP REST API + WebSocket for real-time updates
- **Port**: 7125 (default)
- **Auth**: API Key via `X-Api-Key` header
- **Status/Control Endpoints**:
  - `GET /printer/objects/query?print_stats` - Print status
  - `POST /printer/print/pause` - Pause print
  - `POST /printer/print/resume` - Resume print
  - `POST /printer/print/cancel` - Cancel print
  - `POST /printer/gcode/script` - Send G-code
- **File Transfer**: HTTP multipart POST to `/server/files/upload`

### 3. OctoPrint (HTTP REST)
- **Printers**: Any printer with OctoPrint (Prusa MK3S, Ender series, etc.)
- **Protocol**: HTTP REST API
- **Port**: 80 or 5000
- **Auth**: API Key via `X-Api-Key` header
- **Status/Control Endpoints**:
  - `GET /api/printer` - Printer state
  - `GET /api/job` - Current job info
  - `POST /api/job` - Job control (start/cancel/pause)
  - `POST /api/printer/command` - Send G-code
- **File Transfer**: HTTP multipart POST to `/api/files/local`

### 4. PrusaLink (HTTP REST)
- **Printers**: Prusa MK4, MK3.9, Mini, XL (with built-in networking)
- **Protocol**: HTTP REST API
- **Port**: 80
- **Auth**: API Key via `X-Api-Key` header
- **Status/Control Endpoints**:
  - `GET /api/v1/status` - Printer status
  - `GET /api/v1/job` - Current job
  - `POST /api/v1/job/{id}/pause` - Pause
  - `POST /api/v1/job/{id}/resume` - Resume
- **File Transfer**: HTTP multipart POST

## Architecture

```
                         ┌─────────────────┐
                         │   Cloud Server  │
                         │  (Dashboard)    │
                         └────────┬────────┘
                                  │ WebSocket/MQTT Tunnel
                                  │ (bidirectional)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ESP32-S3 (N16R8)                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   TunnelClient                            │  │
│  │   - Persistent connection to cloud dashboard              │  │
│  │   - Relays printer status upstream                        │  │
│  │   - Receives commands and file streams from cloud         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 PrinterManager                            │  │
│  │   - Manages multiple printer connections                  │  │
│  │   - Unified status polling                                │  │
│  │   - Connection state machine                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            │                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              PrinterClient (Abstract Base)                │  │
│  │   - connect() / disconnect()                              │  │
│  │   - getStatus() -> PrinterStatus                          │  │
│  │   - pause() / resume() / stop()                           │  │
│  │   - sendGcode(cmd)                                        │  │
│  │   - uploadFile(Stream& source)   <-- stream-based!        │  │
│  └───────────────────────────────────────────────────────────┘  │
│           │              │              │              │        │
│  ┌────────┴───┐  ┌───────┴────┐  ┌──────┴─────┐  ┌─────┴────┐  │
│  │BambuClient │  │MoonrakerCli│  │OctoPrintCli│  │PrusaLink │  │
│  │            │  │            │  │            │  │  Client  │  │
│  │ MQTT/TLS   │  │ HTTP/WS    │  │ HTTP REST  │  │ HTTP REST│  │
│  │ + FTPS     │  │            │  │            │  │          │  │
│  └────────────┘  └────────────┘  └────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
                    │              │              │              │
                    ▼              ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
              │ Bambu Lab│  │ Klipper  │  │ OctoPrint│  │  Prusa   │
              │ Printer  │  │ Printer  │  │ Printer  │  │ Printer  │
              └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

## Project Structure

```
AutoPrintFarm-Hub/
├── CLAUDE.md                 # This file
├── platformio.ini            # PlatformIO configuration
├── src/
│   ├── main.cpp              # Entry point, setup/loop
│   ├── config.h              # WiFi credentials, printer configs
│   ├── PrinterManager.h/cpp  # Multi-printer management
│   ├── PrinterClient.h       # Abstract base class
│   ├── PrinterStatus.h       # Unified status structure
│   ├── clients/
│   │   ├── BambuClient.h/cpp      # Bambu Lab MQTT implementation
│   │   ├── MoonrakerClient.h/cpp  # Klipper/Moonraker HTTP/WS
│   │   ├── OctoPrintClient.h/cpp  # OctoPrint REST API
│   │   └── PrusaLinkClient.h/cpp  # PrusaLink REST API
│   └── utils/
│       ├── JsonHelper.h/cpp       # ArduinoJson utilities
│       └── Logger.h/cpp           # Serial logging
├── include/                  # Header files
├── lib/                      # Project-specific libraries
├── data/                     # SPIFFS data (config files)
└── test/                     # Unit tests
```

## Required Libraries

### platformio.ini Configuration

```ini
[env:esp32-s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
board_build.arduino.memory_type = qio_opi
monitor_speed = 115200

build_flags =
    -DBOARD_HAS_PSRAM
    -DARDUINOJSON_ENABLE_PSRAM=1
    -DCORE_DEBUG_LEVEL=1

lib_deps =
    ; MQTT client for Bambu Lab printers
    knolleary/PubSubClient@^2.8

    ; JSON serialization/deserialization (all protocols)
    bblanchon/ArduinoJson@^7.0

    ; WebSocket client for Moonraker real-time updates
    gilmaimon/ArduinoWebsockets@^0.5.3
```

### Built-in ESP32 Libraries (no lib_deps needed)
- **WiFi.h** - WiFi connectivity
- **WiFiClientSecure.h** - TLS/SSL for Bambu MQTT
- **HTTPClient.h** - HTTP requests for OctoPrint/Moonraker/PrusaLink

## File Transfer Architecture

The ESP32 acts as a **streaming relay** for print files - it does NOT store files locally. Print files (G-code, 3MF) can be tens to hundreds of megabytes, far exceeding the ESP32's storage capacity.

### Stream-Through Design

```
Cloud Server                    ESP32                         Printer
    │                            │                              │
    │──── chunk 1 (4-8KB) ──────▶│──── chunk 1 ────────────────▶│
    │──── chunk 2 ──────────────▶│──── chunk 2 ────────────────▶│
    │──── chunk 3 ──────────────▶│──── chunk 3 ────────────────▶│
    │         ...                │         ...                  │
    │──── chunk N ──────────────▶│──── chunk N ────────────────▶│
    │                            │                              │
                          Only 4-8KB in memory
                          at any given time
```

### Protocol-Specific File Transfer

| Protocol | Method | Notes |
|----------|--------|-------|
| **Bambu Lab** | FTPS (port 990, implicit TLS) | Upload via FTP, trigger print via MQTT |
| **Moonraker** | HTTP chunked POST | Stream to `/server/files/upload` |
| **OctoPrint** | HTTP multipart POST | Stream to `/api/files/local` |
| **PrusaLink** | HTTP multipart POST | Similar to OctoPrint |

### Key Implementation Notes

1. **WiFiClientSecure for FTPS**: Bambu's implicit TLS on port 990 works directly with `WiFiClientSecure` - TLS handshake happens immediately on connect
2. **Stream-based API**: All `uploadFile()` methods accept a `Stream&` source, allowing direct piping from the tunnel connection
3. **Backpressure handling**: If the printer is slower than the cloud, the ESP32 must buffer or throttle the incoming stream
4. **No local storage required**: Files are never written to flash/SPIFFS

## Implementation Details

### Unified PrinterStatus Structure

```cpp
struct PrinterStatus {
    // Connection
    bool connected;
    String printerType;      // "bambu", "moonraker", "octoprint", "prusalink"

    // State
    String state;            // "idle", "printing", "paused", "error", "offline"
    String filename;
    float progressPercent;   // 0-100
    uint32_t printTimeSeconds;
    uint32_t remainingSeconds;

    // Temperatures
    float nozzleTemp;
    float nozzleTarget;
    float bedTemp;
    float bedTarget;

    // Optional
    String errorMessage;
    int currentLayer;
    int totalLayers;
};
```

### PrinterClient Abstract Interface

```cpp
class PrinterClient {
public:
    virtual ~PrinterClient() = default;

    // Connection
    virtual bool connect() = 0;
    virtual void disconnect() = 0;
    virtual bool isConnected() = 0;

    // Status
    virtual PrinterStatus getStatus() = 0;
    virtual void poll() = 0;  // Called in loop for MQTT/WS clients

    // Control
    virtual bool pause() = 0;
    virtual bool resume() = 0;
    virtual bool stop() = 0;
    virtual bool sendGcode(const String& gcode) = 0;

    // File Transfer (stream-based - does not store file locally)
    virtual bool uploadFile(Stream& source, const String& filename, size_t fileSize) = 0;
    virtual bool startPrint(const String& filename) = 0;

    // Info
    virtual String getPrinterType() = 0;
    virtual String getPrinterName() = 0;
};
```

### Protocol-Specific Notes

#### Bambu Lab (BambuClient)
- **MQTT Connection**: Uses `WiFiClientSecure` with `setInsecure()` (skip cert verification)
- MQTT keepalive important - printer drops connection after ~60s inactivity
- Must call `mqtt.loop()` frequently in main loop
- Large JSON payloads (~2-4KB) - use streaming parser or adequate buffer
- Sequence IDs should increment with each command
- **FTPS File Upload**:
  - Port 990 uses implicit TLS (connection starts encrypted immediately)
  - `WiFiClientSecure` works directly for this - no STARTTLS needed
  - FTP passive mode requires two TLS connections (control + data channel)
  - After upload, send MQTT `print.project_file` command to start print

#### Moonraker (MoonrakerClient)
- Can use HTTP polling OR WebSocket for real-time
- WebSocket recommended for status updates (less overhead)
- HTTP for commands (simpler, stateless)
- JSON-RPC 2.0 format for WebSocket

#### OctoPrint (OctoPrintClient)
- Pure HTTP REST - simplest implementation
- Consider using existing [OctoPrintAPI](https://github.com/chunkysteveo/OctoPrintAPI) library
- API key required for all requests

#### PrusaLink (PrusaLinkClient)
- Very similar to OctoPrint API structure
- Built into newer Prusa printers (no RPi needed)
- Simpler endpoint structure than OctoPrint

## Development Workflow

### Build and Upload
```bash
# Build
pio run

# Upload
pio run --target upload

# Monitor serial output
pio device monitor
```

### Testing Individual Protocols
1. Configure WiFi credentials in `config.h`
2. Add single printer config for testing
3. Upload and monitor serial for connection status
4. Test basic commands (pause/resume) before full integration

## Memory Considerations

With ESP32-S3 N16R8 (512KB SRAM + 8MB PSRAM), memory is sufficient for all operations including simultaneous cloud tunnel and printer connections with file streaming.

| Resource | Allocation |
|----------|------------|
| Cloud tunnel (WebSocket + TLS) | ~35KB (from PSRAM) |
| Printer MQTT/TLS (Bambu) | ~35KB (from PSRAM) |
| FTPS control channel | ~16KB (from PSRAM) |
| FTPS data channel | ~16KB (from PSRAM) |
| File stream buffer | ~8KB |
| JSON parsing | ~8KB |
| HTTP/WebSocket buffers | ~8KB |
| **Peak during file transfer** | ~130KB |
| **Available PSRAM** | **8MB** |

Enable PSRAM for large allocations:
```cpp
// In setup() or global
ps_malloc(size);  // Allocate from PSRAM
heap_caps_malloc(size, MALLOC_CAP_SPIRAM);  // Explicit PSRAM allocation
```

## Configuration Storage

Printer configurations stored in SPIFFS/LittleFS as JSON:
```json
{
  "printers": [
    {
      "id": "bambu-1",
      "type": "bambu",
      "name": "X1C Workshop",
      "ip": "192.168.1.100",
      "accessCode": "12345678",
      "serial": "00M00A000000000"
    },
    {
      "id": "voron-1",
      "type": "moonraker",
      "name": "Voron 2.4",
      "ip": "192.168.1.101",
      "port": 7125,
      "apiKey": "XXXXX"
    }
  ]
}
```

## Future Enhancements

- OTA firmware updates
- Local web configuration interface
- Print queue management with offline queuing
- Filament tracking integration
- Camera stream relay (if bandwidth permits)

## Reference Links

### Protocol Documentation
- [OpenBambuAPI MQTT Protocol](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)
- [Moonraker API Docs](https://moonraker.readthedocs.io/en/latest/)
- [OctoPrint REST API](https://docs.octoprint.org/en/main/api/index.html)
- [PrusaLink Info](https://help.prusa3d.com/article/prusa-connect-and-prusalink-explained_302608)

### Reference Implementations
- [CYD-Klipper](https://github.com/suchmememanyskill/CYD-Klipper) - Multi-protocol ESP32 display
- [Top-AMS](https://github.com/nccrrv/Top-AMS) - ESP32 Bambu integration
- [bambu-ftp-and-print](https://github.com/darkorb/bambu-ftp-and-print) - Python FTP upload + MQTT print trigger
- [OctoPrintAPI Arduino](https://github.com/chunkysteveo/OctoPrintAPI)
- [BambuLab-StatusBar-LED](https://github.com/ishaanpilar/BambuLab-StatusBar-LED)

### ESP32 Resources
- [ESP32-S3 Datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf)
- [Arduino-ESP32 GitHub](https://github.com/espressif/arduino-esp32)
- [PlatformIO ESP32 Docs](https://docs.platformio.org/en/latest/platforms/espressif32.html)
