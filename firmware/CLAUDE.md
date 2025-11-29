# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoPrintFarm Hub is an ESP32-S3 firmware project providing BLE WiFi provisioning via Web Bluetooth. Users configure WiFi credentials through a browser-based UI that communicates with the ESP32 over Bluetooth Low Energy.

## Build Commands

This project uses PlatformIO:

```bash
pio run                    # Build firmware
pio run --target upload    # Build and flash to device
pio device monitor         # Monitor serial output (115200 baud)
pio run --target clean     # Clean build artifacts
```

Target board: esp32-s3-devkitc-1 with PSRAM enabled.

## Architecture

```
src/
├── main.cpp                 # Entry point, WiFi auto-connect, main loop
├── config.h                 # UUIDs, commands, status codes, timeouts
└── provisioning/
    ├── BLEProvisioning.*    # NimBLE GATT server with 4 characteristics
    └── CredentialStore.*    # Encrypted NVS storage for WiFi credentials

web/
├── index.html               # Web Bluetooth provisioning UI
└── provisioning.js          # BLE communication logic
```

**Key Components:**
- **BLEProvisioning**: Implements GATT server with SSID, Password, Command, and Status characteristics. Uses state machine for WiFi connection lifecycle with 15-second timeout.
- **CredentialStore**: Persists WiFi credentials to ESP32 NVS (namespace: `wifi_creds`). Validates credential lengths.
- **Web Interface**: Vanilla JS using Web Bluetooth API. Dark themed, no build tooling required.

## BLE Protocol

Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`

| Characteristic | UUID suffix | Properties |
|----------------|-------------|------------|
| SSID | `...26a8` | Read/Write |
| Password | `...26a8` (f) | Write |
| Command | `...26a8` (40) | Write |
| Status | `...26a8` (41) | Read/Notify |

Commands: CONNECT (0x01), DISCONNECT (0x02), CLEAR (0xFF)

## Code Conventions

- Logging: Use tagged prefixes like `[BLE]`, `[WiFi]`, `[CredentialStore]`
- Private members: Leading underscore (`_credentialStore`, `_pServer`)
- Constants: UPPER_SNAKE_CASE in config.h
- BLE callbacks: Defer complex operations to main loop via flags (avoid BLE function calls from callback context)

## Important Implementation Notes

- NimBLE security/bonding disabled to avoid Windows pairing issues
- Single BLE connection max (peripheral-only mode)
- WiFi connection is non-blocking with polling in main loop
- Web client validates SSID with `/^[\x20-\x7E]+$/` to filter uninitialized buffer garbage
