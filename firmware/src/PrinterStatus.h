#ifndef PRINTER_STATUS_H
#define PRINTER_STATUS_H

#include <Arduino.h>

// Printer state enumeration
enum class PrinterState {
    OFFLINE,    // Not connected
    IDLE,       // Connected but not printing
    PRINTING,   // Actively printing
    PAUSED,     // Print paused
    ERROR,      // Error state
    UNKNOWN     // Unknown state
};

// Unified printer status structure for all printer types
struct PrinterStatus {
    // Connection state
    bool connected = false;
    String printerType;          // "bambu", "moonraker", "octoprint", "prusalink"

    // Printer state
    PrinterState state = PrinterState::OFFLINE;
    String stateString;          // Human-readable state from printer
    String filename;             // Current/last print filename
    float progressPercent = 0;   // 0-100
    uint32_t printTimeSeconds = 0;
    uint32_t remainingSeconds = 0;

    // Temperatures
    float nozzleTemp = 0;
    float nozzleTarget = 0;
    float bedTemp = 0;
    float bedTarget = 0;

    // Optional extended info
    String errorMessage;
    int currentLayer = 0;
    int totalLayers = 0;

    // Timestamp of last update
    unsigned long lastUpdateMs = 0;

    // Helper to convert PrinterState to string
    static const char* stateToString(PrinterState state) {
        switch (state) {
            case PrinterState::OFFLINE:  return "offline";
            case PrinterState::IDLE:     return "idle";
            case PrinterState::PRINTING: return "printing";
            case PrinterState::PAUSED:   return "paused";
            case PrinterState::ERROR:    return "error";
            default:                     return "unknown";
        }
    }

    // Helper to parse state from common strings
    static PrinterState parseState(const String& stateStr) {
        String lower = stateStr;
        lower.toLowerCase();

        if (lower == "idle" || lower == "standby" || lower == "ready") {
            return PrinterState::IDLE;
        } else if (lower == "printing" || lower == "running" || lower == "busy") {
            return PrinterState::PRINTING;
        } else if (lower == "paused" || lower == "pause") {
            return PrinterState::PAUSED;
        } else if (lower == "error" || lower == "failed" || lower == "fault") {
            return PrinterState::ERROR;
        } else if (lower == "offline" || lower == "disconnected") {
            return PrinterState::OFFLINE;
        }
        return PrinterState::UNKNOWN;
    }
};

#endif // PRINTER_STATUS_H
