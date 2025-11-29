#ifndef CLOUD_MESSAGES_H
#define CLOUD_MESSAGES_H

// =============================================================================
// Message Type Constants
// These must match the cloud backend (hub-connection.ts)
// =============================================================================

namespace HubMessages {
    // Messages sent from Hub to Cloud
    constexpr const char* HUB_HELLO = "hub_hello";
    constexpr const char* PRINTER_STATUS = "printer_status";
    constexpr const char* FILE_PROGRESS = "file_progress";
    constexpr const char* COMMAND_ACK = "command_ack";
    constexpr const char* PRINTER_DISCOVERED = "printer_discovered";
}

namespace CloudMessages {
    // Messages sent from Cloud to Hub
    constexpr const char* HUB_WELCOME = "hub_welcome";
    constexpr const char* HUB_CONFIG = "hub_config";  // Config updates (name, etc.)
    constexpr const char* CONFIGURE_PRINTER = "configure_printer";
    constexpr const char* PRINT_COMMAND = "print_command";
    constexpr const char* PRINTER_COMMAND = "printer_command";
    constexpr const char* DISCOVER_PRINTERS = "discover_printers";
    constexpr const char* HUB_COMMAND = "hub_command";
    constexpr const char* ERROR = "error";
}

#endif // CLOUD_MESSAGES_H
