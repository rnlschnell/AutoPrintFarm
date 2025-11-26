#ifndef TUNNEL_MESSAGES_H
#define TUNNEL_MESSAGES_H

/**
 * Message type constants for Hub <-> Cloud communication.
 * Must match cloud/src/types/index.ts definitions exactly.
 */

// =============================================================================
// Hub -> Cloud message types
// =============================================================================

namespace HubMessages {
    // Connection initialization
    constexpr const char* HUB_HELLO = "hub_hello";

    // Printer status update
    constexpr const char* PRINTER_STATUS = "printer_status";

    // File transfer progress
    constexpr const char* FILE_PROGRESS = "file_progress";

    // Command acknowledgment
    constexpr const char* COMMAND_ACK = "command_ack";

    // Discovered printers from network scan
    constexpr const char* PRINTER_DISCOVERED = "printer_discovered";
}

// =============================================================================
// Cloud -> Hub message types
// =============================================================================

namespace CloudMessages {
    // Welcome response after hub_hello
    constexpr const char* HUB_WELCOME = "hub_welcome";

    // Add/remove/update printer configuration
    constexpr const char* CONFIGURE_PRINTER = "configure_printer";

    // Start a print job (download file, upload to printer, start)
    constexpr const char* PRINT_COMMAND = "print_command";

    // Control commands (pause/resume/stop/clear_bed)
    constexpr const char* PRINTER_COMMAND = "printer_command";

    // Trigger network printer discovery
    constexpr const char* DISCOVER_PRINTERS = "discover_printers";

    // Error message
    constexpr const char* ERROR = "error";
}

// =============================================================================
// Printer status strings (match cloud PrinterStatus type)
// =============================================================================

namespace PrinterStatusStrings {
    constexpr const char* IDLE = "idle";
    constexpr const char* PRINTING = "printing";
    constexpr const char* PAUSED = "paused";
    constexpr const char* MAINTENANCE = "maintenance";
    constexpr const char* OFFLINE = "offline";
    constexpr const char* ERROR = "error";
}

// =============================================================================
// Printer connection types (match cloud PrinterConnectionType)
// =============================================================================

namespace ConnectionTypes {
    constexpr const char* BAMBU = "bambu";
    constexpr const char* PRUSA = "prusa";
    constexpr const char* OCTOPRINT = "octoprint";
    constexpr const char* KLIPPER = "klipper";
    constexpr const char* OTHER = "other";
}

// =============================================================================
// Configure printer actions
// =============================================================================

namespace ConfigureActions {
    constexpr const char* ADD = "add";
    constexpr const char* REMOVE = "remove";
    constexpr const char* UPDATE = "update";
}

// =============================================================================
// Printer command actions
// =============================================================================

namespace PrinterActions {
    constexpr const char* PAUSE = "pause";
    constexpr const char* RESUME = "resume";
    constexpr const char* STOP = "stop";
    constexpr const char* CLEAR_BED = "clear_bed";
}

// =============================================================================
// File progress stages
// =============================================================================

namespace FileStages {
    constexpr const char* DOWNLOADING = "downloading";
    constexpr const char* UPLOADING = "uploading";
    constexpr const char* COMPLETE = "complete";
    constexpr const char* FAILED = "failed";
}

#endif // TUNNEL_MESSAGES_H
