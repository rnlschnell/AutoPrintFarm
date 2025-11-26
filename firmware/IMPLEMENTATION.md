# AutoPrintFarm-Hub Implementation Tracker

This document tracks the implementation progress of the AutoPrintFarm-Hub project. Each phase is scoped to be completable in a single Claude Code session.

---

## Current Status Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | **COMPLETE** | Project Foundation & WiFi Provisioning |
| Phase 2 | NOT STARTED | Core Infrastructure & Abstractions |
| Phase 3 | NOT STARTED | OctoPrint Client Implementation |
| Phase 4 | NOT STARTED | PrusaLink Client Implementation |
| Phase 5 | NOT STARTED | Moonraker Client Implementation |
| Phase 6 | NOT STARTED | Bambu Lab Client - MQTT Status |
| Phase 7 | NOT STARTED | Bambu Lab Client - FTPS File Transfer |
| Phase 8 | NOT STARTED | PrinterManager & Multi-Printer Support |
| Phase 9 | NOT STARTED | Cloud Tunnel - Connection & Status |
| Phase 10 | NOT STARTED | Cloud Tunnel - Commands & File Streaming |
| Phase 11 | NOT STARTED | Configuration Storage & Management |
| Phase 12 | NOT STARTED | System Polish & Error Handling |

---

## Phase 1: Project Foundation & WiFi Provisioning
**Status: COMPLETE**

### Completed Items
- [x] PlatformIO project setup for ESP32-S3-WROOM-1 N16R8
- [x] PSRAM configuration and build flags
- [x] Required library dependencies (NimBLE, PubSubClient, ArduinoJson, WebSockets)
- [x] BLE WiFi provisioning system
  - [x] BLEProvisioning class with NimBLE
  - [x] WiFiManager for connection handling
  - [x] CredentialStore for NVS persistence
  - [x] Network scanning capability
  - [x] Status notifications to BLE clients
- [x] Web Bluetooth companion page (web/index.html, web/provisioning.js)
- [x] Debug logging infrastructure
- [x] Basic main.cpp with setup/loop structure

---

## Phase 2: Core Infrastructure & Abstractions
**Status: NOT STARTED**

### Goals
Create the foundational classes and structures that all printer clients will use.

### Tasks
- [ ] Create `PrinterStatus.h` struct with unified status fields
- [ ] Create `PrinterClient.h` abstract base class with virtual interface
- [ ] Create `src/utils/Logger.h/cpp` with log levels and formatted output
- [ ] Create `src/utils/JsonHelper.h/cpp` for common JSON operations
- [ ] Add PSRAM allocation helpers

### Files to Create
- `src/PrinterStatus.h`
- `src/PrinterClient.h`
- `src/utils/Logger.h`
- `src/utils/Logger.cpp`
- `src/utils/JsonHelper.h`
- `src/utils/JsonHelper.cpp`

---

## Phase 3: OctoPrint Client Implementation
**Status: NOT STARTED**

### Goals
Implement the simplest printer client (HTTP REST only) to establish patterns.

### Tasks
- [ ] Create OctoPrintClient class inheriting from PrinterClient
- [ ] Implement connection with API key authentication
- [ ] Implement status polling via `/api/printer` and `/api/job`
- [ ] Implement print control (pause/resume/cancel via `/api/job`)
- [ ] Implement G-code sending via `/api/printer/command`
- [ ] Implement stream-based file upload to `/api/files/local`
- [ ] Implement startPrint to begin uploaded file
- [ ] Parse OctoPrint JSON responses to PrinterStatus

### Files to Create
- `src/clients/OctoPrintClient.h`
- `src/clients/OctoPrintClient.cpp`

### Testing Checklist
- [ ] Connect to OctoPrint instance
- [ ] Retrieve printer status
- [ ] Send G-code command
- [ ] Upload small test file
- [ ] Start print

---

## Phase 4: PrusaLink Client Implementation
**Status: NOT STARTED**

### Goals
Implement PrusaLink client (similar to OctoPrint but different endpoints).

### Tasks
- [ ] Create PrusaLinkClient class inheriting from PrinterClient
- [ ] Implement connection with API key authentication
- [ ] Implement status polling via `/api/v1/status` and `/api/v1/job`
- [ ] Implement print control (pause/resume via `/api/v1/job/{id}/*`)
- [ ] Implement G-code sending
- [ ] Implement stream-based file upload
- [ ] Implement startPrint
- [ ] Parse PrusaLink JSON responses to PrinterStatus

### Files to Create
- `src/clients/PrusaLinkClient.h`
- `src/clients/PrusaLinkClient.cpp`

### Testing Checklist
- [ ] Connect to PrusaLink instance
- [ ] Retrieve printer status
- [ ] Send G-code command
- [ ] Upload small test file
- [ ] Start print

---

## Phase 5: Moonraker Client Implementation
**Status: NOT STARTED**

### Goals
Implement Moonraker/Klipper client with WebSocket for real-time updates.

### Tasks
- [ ] Create MoonrakerClient class inheriting from PrinterClient
- [ ] Implement HTTP connection and API key authentication
- [ ] Implement WebSocket connection for real-time status
- [ ] Implement status parsing from `/printer/objects/query`
- [ ] Implement print control endpoints
- [ ] Implement G-code sending via `/printer/gcode/script`
- [ ] Implement stream-based file upload to `/server/files/upload`
- [ ] Implement startPrint via `/printer/print/start`
- [ ] Handle WebSocket reconnection logic

### Files to Create
- `src/clients/MoonrakerClient.h`
- `src/clients/MoonrakerClient.cpp`

### Testing Checklist
- [ ] Connect to Moonraker instance (HTTP)
- [ ] Establish WebSocket connection
- [ ] Receive real-time status updates
- [ ] Send G-code command
- [ ] Upload small test file
- [ ] Start print

---

## Phase 6: Bambu Lab Client - MQTT Status
**Status: NOT STARTED**

### Goals
Implement Bambu Lab MQTT connection for status and control (no file transfer yet).

### Tasks
- [ ] Create BambuClient class inheriting from PrinterClient
- [ ] Implement TLS connection using WiFiClientSecure
- [ ] Implement MQTT connection with PubSubClient
- [ ] Subscribe to `device/{serial}/report` topic
- [ ] Parse Bambu JSON status messages to PrinterStatus
- [ ] Implement command publishing to `device/{serial}/request`
- [ ] Implement pause/resume/stop commands
- [ ] Implement G-code sending via MQTT
- [ ] Handle MQTT keepalive and reconnection
- [ ] Implement sequence ID tracking for commands
### Files to Create
- `src/clients/BambuClient.h`
- `src/clients/BambuClient.cpp`

### Testing Checklist
- [ ] Connect to Bambu printer via MQTT/TLS
- [ ] Receive status updates
- [ ] Parse print progress, temperatures, state
- [ ] Send pause command
- [ ] Send resume command
- [ ] Send G-code command

---

## Phase 7: Bambu Lab Client - FTPS File Transfer
**Status: NOT STARTED**

### Goals
Add FTPS file upload capability to BambuClient.

### Tasks
- [ ] Implement FTPS control channel connection (port 990, implicit TLS)
- [ ] Implement FTP command/response handling
- [ ] Implement PASV mode for data channel
- [ ] Implement data channel TLS connection
- [ ] Implement stream-based STOR command for file upload
- [ ] Implement startPrint via MQTT `print.project_file` command
- [ ] Handle FTP error responses
- [ ] Clean up connections after transfer

### Files to Modify
- `src/clients/BambuClient.h` (add FTPS methods)
- `src/clients/BambuClient.cpp` (add FTPS implementation)

### Testing Checklist
- [ ] Connect to FTPS server
- [ ] Authenticate successfully
- [ ] Enter passive mode
- [ ] Upload small 3MF file
- [ ] Trigger print via MQTT
- [ ] Verify print starts

---

## Phase 8: PrinterManager & Multi-Printer Support
**Status: NOT STARTED**

### Goals
Create manager class to handle multiple printer connections simultaneously.

### Tasks
- [ ] Create PrinterManager class
- [ ] Implement printer registration/deregistration
- [ ] Implement connection state machine per printer
- [ ] Implement unified polling loop
- [ ] Implement status aggregation across all printers
- [ ] Implement command routing to specific printer by ID
- [ ] Implement automatic reconnection with backoff
- [ ] Add printer discovery helpers

### Files to Create
- `src/PrinterManager.h`
- `src/PrinterManager.cpp`

### Testing Checklist
- [ ] Register multiple printers of different types
- [ ] Poll all printers for status
- [ ] Send command to specific printer
- [ ] Handle printer disconnect/reconnect
- [ ] Get aggregated status

---

## Phase 9: Cloud Tunnel - Connection & Status
**Status: NOT STARTED**

### Goals
Establish persistent WebSocket connection to cloud dashboard for status reporting.

### Tasks
- [ ] Create TunnelClient class
- [ ] Implement WebSocket connection with TLS
- [ ] Implement authentication/handshake protocol
- [ ] Implement heartbeat/keepalive mechanism
- [ ] Implement status message formatting
- [ ] Push printer status updates to cloud
- [ ] Handle connection loss and reconnection
- [ ] Implement message queue for offline buffering

### Files to Create
- `src/TunnelClient.h`
- `src/TunnelClient.cpp`

### Testing Checklist
- [ ] Connect to cloud WebSocket endpoint
- [ ] Authenticate successfully
- [ ] Send status updates
- [ ] Receive acknowledgments
- [ ] Reconnect after disconnect

---

## Phase 10: Cloud Tunnel - Commands & File Streaming
**Status: NOT STARTED**

### Goals
Handle incoming commands and file streams from cloud.

### Tasks
- [ ] Implement command message parsing
- [ ] Route commands to appropriate PrinterClient via PrinterManager
- [ ] Implement file stream reception
- [ ] Pipe file stream directly to PrinterClient.uploadFile()
- [ ] Implement backpressure handling for slow printers
- [ ] Send command results back to cloud
- [ ] Send file transfer progress updates
- [ ] Handle transfer cancellation

### Files to Modify
- `src/TunnelClient.h`
- `src/TunnelClient.cpp`

### Testing Checklist
- [ ] Receive print command from cloud
- [ ] Execute pause/resume on correct printer
- [ ] Receive file stream from cloud
- [ ] Stream file to printer successfully
- [ ] Report transfer progress
- [ ] Handle transfer cancellation

---

## Phase 11: Configuration Storage & Management
**Status: NOT STARTED**

### Goals
Implement persistent storage for printer and cloud configurations.

### Tasks
- [ ] Initialize LittleFS/SPIFFS filesystem
- [ ] Create config file structure for printers.json
- [ ] Create config file structure for cloud.json
- [ ] Implement config read/write functions
- [ ] Add printer config via BLE provisioning
- [ ] Add cloud config via BLE provisioning
- [ ] Extend BLE characteristics for printer management
- [ ] Update web companion page for printer configuration

### Files to Create
- `src/ConfigManager.h`
- `src/ConfigManager.cpp`

### Files to Modify
- `src/provisioning/BLEProvisioning.h`
- `src/provisioning/BLEProvisioning.cpp`
- `web/index.html`
- `web/provisioning.js`

### Testing Checklist
- [ ] Save printer config to filesystem
- [ ] Load printer config on boot
- [ ] Add printer via BLE
- [ ] Remove printer via BLE
- [ ] Save/load cloud config

---

## Phase 12: System Polish & Error Handling
**Status: NOT STARTED**

### Goals
Harden the system with proper error handling, recovery, and monitoring.

### Tasks
- [ ] Add comprehensive error codes and messages
- [ ] Implement watchdog timer
- [ ] Add memory monitoring and PSRAM usage tracking
- [ ] Implement graceful degradation on low memory
- [ ] Add status LED indication patterns
- [ ] Implement system health reporting to cloud
- [ ] Add OTA update framework
- [ ] Review and fix any memory leaks
- [ ] Stress test with multiple printers

### Files to Create/Modify
- `src/SystemMonitor.h`
- `src/SystemMonitor.cpp`
- Various error handling additions across all modules

### Testing Checklist
- [ ] System recovers from WiFi loss
- [ ] System recovers from cloud disconnect
- [ ] System handles printer disconnect gracefully
- [ ] Memory stays stable over extended operation
- [ ] Watchdog prevents hangs
- [ ] OTA update works

---

## Future Enhancements (Post-MVP)

These items are not critical for initial release but are planned for future development:

- [ ] Local web configuration interface
- [ ] Print queue management with offline queuing
- [ ] Filament tracking integration
- [ ] Camera stream relay (if bandwidth permits)
- [ ] Printer auto-discovery (mDNS)
- [ ] Multiple Hub coordination
- [ ] Power consumption optimization
- [ ] Hardware watchdog integration

---

## Notes

### Session Guidelines
- Each phase should be completable in a single Claude Code session
- Test each phase thoroughly before moving to the next
- Update this document as tasks are completed
- If a phase is too large, it may be split into sub-phases

### Dependencies
- Phases 3-7 can be done in any order (independent client implementations)
- Phase 8 requires at least one client from Phases 3-7
- Phases 9-10 can be developed in parallel with client implementations
- Phase 11 can be started after Phase 1
- Phase 12 should be done after core functionality is working

### Hardware Testing
A physical ESP32-S3 N16R8 board and at least one 3D printer are needed for testing. Printer types available for testing should be noted here:
- [ ] Bambu Lab printer available
- [ ] Klipper/Moonraker printer available
- [ ] OctoPrint instance available
- [ ] PrusaLink printer available
