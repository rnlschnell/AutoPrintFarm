/**
 * Hub Commands Helper Library
 *
 * Provides helper functions for sending commands to ESP32 hubs
 * via the HubConnection Durable Object.
 */

import type { Env } from "../types/env";
import type {
  ConfigurePrinterMessage,
  PrintCommandMessage,
  PrinterCommandMessage,
  DiscoverPrintersMessage,
  HubCommandMessage,
  HubConfigMessage,
  PrinterConnectionType,
} from "../types";
import { generateId } from "./crypto";

// =============================================================================
// TYPES
// =============================================================================

export interface CommandResponse {
  success: boolean;
  command_id: string;
  error?: string;
}

export interface HubStatusResponse {
  success: boolean;
  data: {
    hub_id: string | null;
    tenant_id: string | null;
    connected: boolean;
    authenticated: boolean;
    connected_at?: number;
    last_message_at?: number;
    firmware_version?: string;
    pending_commands: number;
  };
}

export interface PrinterConfig {
  id: string;
  serial_number: string;
  access_code?: string;
  ip_address?: string;
  connection_type: PrinterConnectionType;
}

// =============================================================================
// HUB COMMAND SENDER
// =============================================================================

/**
 * Send a command to a hub via its Durable Object
 */
export async function sendHubCommand(
  env: Env,
  hubId: string,
  command: ConfigurePrinterMessage | PrintCommandMessage | PrinterCommandMessage | DiscoverPrintersMessage | HubCommandMessage | HubConfigMessage,
  options: { waitForAck?: boolean; timeout?: number } = {}
): Promise<CommandResponse> {
  // Get the Durable Object stub
  const doId = env.HUB_CONNECTIONS.idFromName(hubId);
  const stub = env.HUB_CONNECTIONS.get(doId);

  // Send command to the DO
  const response = await stub.fetch("http://internal/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send_command",
      command,
      waitForAck: options.waitForAck ?? false,
      timeout: options.timeout,
    }),
  });

  return (await response.json()) as CommandResponse;
}

/**
 * Get the status of a hub connection
 */
export async function getHubStatus(
  env: Env,
  hubId: string
): Promise<HubStatusResponse> {
  const doId = env.HUB_CONNECTIONS.idFromName(hubId);
  const stub = env.HUB_CONNECTIONS.get(doId);

  const response = await stub.fetch("http://internal/status", {
    method: "GET",
  });

  return (await response.json()) as HubStatusResponse;
}

// =============================================================================
// COMMAND BUILDERS
// =============================================================================

/**
 * Build a configure_printer command to add a printer to a hub
 */
export function buildAddPrinterCommand(printer: PrinterConfig): ConfigurePrinterMessage {
  const printerObj: ConfigurePrinterMessage["printer"] = {
    id: printer.id,
    serial_number: printer.serial_number,
    connection_type: printer.connection_type,
  };
  if (printer.access_code) printerObj.access_code = printer.access_code;
  if (printer.ip_address) printerObj.ip_address = printer.ip_address;

  return {
    type: "configure_printer",
    command_id: generateId(),
    action: "add",
    printer: printerObj,
  };
}

/**
 * Build a configure_printer command to remove a printer from a hub
 */
export function buildRemovePrinterCommand(
  printerId: string,
  serialNumber: string,
  connectionType: PrinterConnectionType
): ConfigurePrinterMessage {
  return {
    type: "configure_printer",
    command_id: generateId(),
    action: "remove",
    printer: {
      id: printerId,
      serial_number: serialNumber,
      connection_type: connectionType,
    },
  };
}

/**
 * Build a configure_printer command to update a printer on a hub
 */
export function buildUpdatePrinterCommand(printer: PrinterConfig): ConfigurePrinterMessage {
  const printerObj: ConfigurePrinterMessage["printer"] = {
    id: printer.id,
    serial_number: printer.serial_number,
    connection_type: printer.connection_type,
  };
  if (printer.access_code) printerObj.access_code = printer.access_code;
  if (printer.ip_address) printerObj.ip_address = printer.ip_address;

  return {
    type: "configure_printer",
    command_id: generateId(),
    action: "update",
    printer: printerObj,
  };
}

/**
 * Build a print_command to start a print job
 */
export function buildPrintCommand(
  printerId: string,
  jobId: string,
  fileUrl: string,
  fileName: string
): PrintCommandMessage {
  return {
    type: "print_command",
    command_id: generateId(),
    printer_id: printerId,
    job_id: jobId,
    action: "start",
    file_url: fileUrl,
    file_name: fileName,
  };
}

/**
 * Build a printer_command for control actions (pause/resume/stop/clear_bed/light_on/light_off)
 */
export function buildPrinterControlCommand(
  printerId: string,
  action: "pause" | "resume" | "stop" | "clear_bed" | "light_on" | "light_off"
): PrinterCommandMessage {
  return {
    type: "printer_command",
    command_id: generateId(),
    printer_id: printerId,
    action,
  };
}

/**
 * Build a discover_printers command
 */
export function buildDiscoverPrintersCommand(): DiscoverPrintersMessage {
  return {
    type: "discover_printers",
    command_id: generateId(),
  };
}

/**
 * Build a hub_command to disconnect the hub from cloud
 */
export function buildHubDisconnectCommand(): HubCommandMessage {
  return {
    type: "hub_command",
    command_id: generateId(),
    action: "disconnect",
  };
}

/**
 * Build a hub_command to set GPIO pin state
 */
export function buildGpioSetCommand(pin: number, state: boolean): HubCommandMessage {
  return {
    type: "hub_command",
    command_id: generateId(),
    action: "gpio_set",
    gpio_pin: pin,
    gpio_state: state,
  };
}

/**
 * Build a hub_config message to update hub configuration
 */
export function buildHubConfigCommand(config: { hub_name?: string }): HubConfigMessage {
  return {
    type: "hub_config",
    command_id: generateId(),
    hub_name: config.hub_name,
  };
}

// =============================================================================
// HIGH-LEVEL OPERATIONS
// =============================================================================

/**
 * Add a printer to a hub (configure connection)
 */
export async function addPrinterToHub(
  env: Env,
  hubId: string,
  printer: PrinterConfig,
  waitForAck = true
): Promise<CommandResponse> {
  const command = buildAddPrinterCommand(printer);
  return sendHubCommand(env, hubId, command, { waitForAck });
}

/**
 * Remove a printer from a hub
 */
export async function removePrinterFromHub(
  env: Env,
  hubId: string,
  printerId: string,
  serialNumber: string,
  connectionType: PrinterConnectionType,
  waitForAck = true
): Promise<CommandResponse> {
  const command = buildRemovePrinterCommand(printerId, serialNumber, connectionType);
  return sendHubCommand(env, hubId, command, { waitForAck });
}

/**
 * Send a control command to a printer (pause/resume/stop/clear_bed/light_on/light_off)
 */
export async function sendPrinterControl(
  env: Env,
  hubId: string,
  printerSerialNumber: string,
  action: "pause" | "resume" | "stop" | "clear_bed" | "light_on" | "light_off",
  waitForAck = true
): Promise<CommandResponse> {
  const command = buildPrinterControlCommand(printerSerialNumber, action);
  return sendHubCommand(env, hubId, command, { waitForAck });
}

/**
 * Start a print job on a printer
 */
export async function startPrintJob(
  env: Env,
  hubId: string,
  printerSerialNumber: string,
  jobId: string,
  fileUrl: string,
  fileName: string,
  waitForAck = true
): Promise<CommandResponse> {
  const command = buildPrintCommand(printerSerialNumber, jobId, fileUrl, fileName);
  return sendHubCommand(env, hubId, command, { waitForAck, timeout: 60000 }); // Longer timeout for file transfers
}

/**
 * Trigger printer discovery on a hub
 */
export async function discoverPrinters(
  env: Env,
  hubId: string
): Promise<CommandResponse> {
  const command = buildDiscoverPrintersCommand();
  return sendHubCommand(env, hubId, command, { waitForAck: false });
}

/**
 * Check if a hub is online and connected
 */
export async function isHubOnline(env: Env, hubId: string): Promise<boolean> {
  try {
    const status = await getHubStatus(env, hubId);
    return status.success && status.data.connected && status.data.authenticated;
  } catch {
    return false;
  }
}

/**
 * Disconnect a hub from cloud (hub will need restart to reconnect)
 */
export async function disconnectHub(
  env: Env,
  hubId: string
): Promise<CommandResponse> {
  const command = buildHubDisconnectCommand();
  return sendHubCommand(env, hubId, command, { waitForAck: true, timeout: 5000 });
}

/**
 * Set GPIO pin state on a hub
 */
export async function setHubGpio(
  env: Env,
  hubId: string,
  pin: number,
  state: boolean
): Promise<CommandResponse> {
  const command = buildGpioSetCommand(pin, state);
  return sendHubCommand(env, hubId, command, { waitForAck: true, timeout: 5000 });
}

/**
 * Update hub configuration (name, etc.)
 */
export async function updateHubConfig(
  env: Env,
  hubId: string,
  config: { hub_name?: string }
): Promise<CommandResponse> {
  const command = buildHubConfigCommand(config);
  return sendHubCommand(env, hubId, command, { waitForAck: true, timeout: 5000 });
}
