#ifndef PRINTER_CLIENT_H
#define PRINTER_CLIENT_H

#include <Arduino.h>
#include "PrinterStatus.h"

// Forward declaration for stream-based file transfer (future)
class Stream;

/**
 * Abstract base class for all printer protocol implementations.
 *
 * Implementations:
 * - BambuClient (MQTT over TLS)
 * - MoonrakerClient (HTTP/WebSocket) - future
 * - OctoPrintClient (HTTP REST) - future
 * - PrusaLinkClient (HTTP REST) - future
 */
class PrinterClient {
public:
    virtual ~PrinterClient() = default;

    // ========== Connection Lifecycle ==========

    /**
     * Establish connection to the printer.
     * @return true if connection successful
     */
    virtual bool connect() = 0;

    /**
     * Disconnect from the printer.
     */
    virtual void disconnect() = 0;

    /**
     * Check if currently connected.
     * @return true if connected
     */
    virtual bool isConnected() = 0;

    // ========== Status ==========

    /**
     * Get current printer status.
     * @return PrinterStatus structure with current state
     */
    virtual PrinterStatus getStatus() = 0;

    /**
     * Poll for updates. Must be called frequently in main loop.
     * Handles MQTT loop, WebSocket messages, reconnection, etc.
     */
    virtual void poll() = 0;

    // ========== Control Commands ==========

    /**
     * Pause current print.
     * @return true if command sent successfully
     */
    virtual bool pause() = 0;

    /**
     * Resume paused print.
     * @return true if command sent successfully
     */
    virtual bool resume() = 0;

    /**
     * Stop/cancel current print.
     * @return true if command sent successfully
     */
    virtual bool stop() = 0;

    /**
     * Send raw G-code command.
     * @param gcode G-code string to send
     * @return true if command sent successfully
     */
    virtual bool sendGcode(const String& gcode) = 0;

    /**
     * Control printer chamber/work light.
     * @param on true to turn light on, false to turn off
     * @return true if command sent successfully
     */
    virtual bool setLight(bool on) = 0;

    // ========== File Transfer ==========

    /**
     * Upload a file to the printer (stream-based, no local storage).
     * @param source Stream source for file data
     * @param filename Destination filename on printer
     * @param fileSize Total file size in bytes
     * @return true if upload successful
     */
    virtual bool uploadFile(Stream& source, const String& filename, size_t fileSize) = 0;

    /**
     * Start printing a file already on the printer.
     * @param filename Filename to print
     * @return true if print started successfully
     */
    virtual bool startPrint(const String& filename) = 0;

    // ========== Identification ==========

    /**
     * Get printer protocol type.
     * @return Protocol identifier ("bambu", "moonraker", "octoprint", "prusalink")
     */
    virtual String getPrinterType() = 0;

    /**
     * Get user-friendly printer name.
     * @return Printer name string
     */
    virtual String getPrinterName() = 0;

    /**
     * Get unique printer identifier.
     * @return Printer ID string
     */
    virtual String getPrinterId() = 0;
};

#endif // PRINTER_CLIENT_H
