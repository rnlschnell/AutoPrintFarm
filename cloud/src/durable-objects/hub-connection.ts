/**
 * HubConnection Durable Object
 *
 * Manages WebSocket connections between ESP32 hubs and the cloud backend.
 * Each instance represents a single hub's connection state.
 *
 * Responsibilities:
 * - Maintain WebSocket connection to hub
 * - Track hub status (online/offline, last seen)
 * - Route commands from API to hub
 * - Process printer status updates from hub
 * - Handle reconnection and heartbeat logic
 *
 * WebSocket Protocol:
 * - Hub → Cloud: hub_hello, printer_status, file_progress, command_ack, printer_discovered
 * - Cloud → Hub: configure_printer, print_command, printer_command, discover_printers
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "../types/env";
import type {
  HubToCloudMessage,
  CloudToHubMessage,
  HubHelloMessage,
  PrinterStatusMessage,
  FileProgressMessage,
  CommandAckMessage,
  PrinterDiscoveredMessage,
} from "../types";
import { generateId } from "../lib/crypto";

// =============================================================================
// TYPES
// =============================================================================

interface PendingCommand {
  commandId: string;
  type: string;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timeout: number; // setTimeout ID
  createdAt: number;
}

interface CommandResult {
  success: boolean;
  error?: string;
}

interface HubSession {
  hubId: string;
  tenantId: string;
  authenticated: boolean;
  connectedAt: number;
  lastMessageAt: number;
  firmwareVersion?: string;
  hardwareVersion?: string;
  macAddress?: string;
}

interface InternalCommand {
  action: "send_command";
  command: CloudToHubMessage;
  waitForAck?: boolean;
  timeout?: number;
}

interface StatusRequest {
  action: "get_status";
}

type InternalRequest = InternalCommand | StatusRequest;

// =============================================================================
// CONSTANTS
// =============================================================================

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 60_000; // 60 seconds - mark offline if no activity
const COMMAND_TIMEOUT_MS = 30_000; // 30 seconds for command acknowledgment
const AUTH_TIMEOUT_MS = 10_000; // 10 seconds to authenticate after connect

// =============================================================================
// HUB CONNECTION DURABLE OBJECT
// =============================================================================

export class HubConnection {
  readonly state: DurableObjectState;
  readonly env: Env;

  // WebSocket connection (using hibernation API)
  private session: HubSession | null = null;
  private pendingCommands: Map<string, PendingCommand> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ===========================================================================
  // FETCH HANDLER
  // ===========================================================================

  /**
   * Handle incoming HTTP requests to this Durable Object
   * - WebSocket upgrade requests for hub connections
   * - Internal API requests for sending commands
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade request
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Internal command endpoint (called by API routes)
    if (url.pathname === "/command" && request.method === "POST") {
      return this.handleCommandRequest(request);
    }

    // Status endpoint
    if (url.pathname === "/status" && request.method === "GET") {
      return this.handleStatusRequest();
    }

    return new Response("Not Found", { status: 404 });
  }

  // ===========================================================================
  // WEBSOCKET UPGRADE
  // ===========================================================================

  /**
   * Handle WebSocket upgrade request from ESP32 hub
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract hub ID from URL path (e.g., /ws/hub/abc123)
    const pathParts = url.pathname.split("/");
    const hubId = pathParts[pathParts.length - 1];

    if (!hubId) {
      console.log(`[HubConnection] ❌ WebSocket upgrade rejected: missing hub ID`);
      return new Response("Hub ID required", { status: 400 });
    }

    // Look up hub in database
    const hub = await this.env.DB.prepare(
      "SELECT id, tenant_id, secret_hash FROM hubs WHERE id = ?"
    )
      .bind(hubId)
      .first<{ id: string; tenant_id: string | null; secret_hash: string }>();

    if (!hub) {
      console.log(`[HubConnection] ❌ WebSocket upgrade rejected: hub ${hubId} not found in database`);
      return new Response("Hub not found", { status: 404 });
    }

    // Hub must be claimed (have a tenant_id) to connect
    if (!hub.tenant_id) {
      console.log(`[HubConnection] ❌ WebSocket upgrade rejected: hub ${hubId} not claimed by any tenant`);
      return new Response("Hub not claimed", { status: 403 });
    }

    // Create WebSocket pair
    const { 0: client, 1: server } = new WebSocketPair();

    // Accept the WebSocket connection using hibernation API
    this.state.acceptWebSocket(server, [hubId]);

    // Initialize session (will be authenticated on hub_hello)
    this.session = {
      hubId,
      tenantId: hub.tenant_id,
      authenticated: false,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    // Store hub secret for later authentication
    await this.state.storage.put("hubSecret", hub.secret_hash);
    await this.state.storage.put("hubId", hubId);
    await this.state.storage.put("tenantId", hub.tenant_id);

    // Set alarm for authentication timeout
    await this.state.storage.setAlarm(Date.now() + AUTH_TIMEOUT_MS);

    console.log(`[HubConnection] ✅ WebSocket upgrade accepted for hub ${hubId} (tenant: ${hub.tenant_id})`);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // ===========================================================================
  // WEBSOCKET MESSAGE HANDLERS (Hibernation API)
  // ===========================================================================

  /**
   * Called when a WebSocket message is received (hibernation API)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Update last message timestamp
    if (this.session) {
      this.session.lastMessageAt = Date.now();
    }

    // Parse message
    let data: HubToCloudMessage;
    try {
      const messageStr = typeof message === "string" ? message : new TextDecoder().decode(message);
      data = JSON.parse(messageStr) as HubToCloudMessage;
    } catch (error) {
      console.error("[HubConnection] Failed to parse message:", error);
      this.sendError(ws, "INVALID_MESSAGE", "Failed to parse message");
      return;
    }

    console.log(`[HubConnection] 📨 Received message: ${data.type} from hub ${this.session?.hubId || 'unknown'}`);

    // Route to appropriate handler
    switch (data.type) {
      case "hub_hello":
        await this.handleHubHello(ws, data);
        break;
      case "printer_status":
        await this.handlePrinterStatus(ws, data);
        break;
      case "file_progress":
        await this.handleFileProgress(ws, data);
        break;
      case "command_ack":
        await this.handleCommandAck(ws, data);
        break;
      case "printer_discovered":
        await this.handlePrinterDiscovered(ws, data);
        break;
      default:
        console.warn(`[HubConnection] Unknown message type: ${(data as HubToCloudMessage).type}`);
        this.sendError(ws, "UNKNOWN_MESSAGE_TYPE", `Unknown message type`);
    }
  }

  /**
   * Called when WebSocket is closed (hibernation API)
   */
  async webSocketClose(_ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    console.log(`[HubConnection] 🔌 WebSocket closed for hub ${this.session?.hubId || 'unknown'}: code=${code}, reason=${reason || 'none'}, clean=${wasClean}`);

    await this.handleDisconnect();
  }

  /**
   * Called when WebSocket encounters an error (hibernation API)
   */
  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("[HubConnection] WebSocket error:", error);

    await this.handleDisconnect();
  }

  /**
   * Alarm handler for timeouts and heartbeats
   */
  async alarm(): Promise<void> {
    const hubId = await this.state.storage.get<string>("hubId");

    // Check if we have an active WebSocket
    const websockets = this.state.getWebSockets();
    if (websockets.length === 0) {
      console.log(`[HubConnection] 🧹 Hub ${hubId}: no active WebSockets, cleaning up`);
      await this.handleDisconnect();
      return;
    }

    // Check if authenticated
    if (this.session && !this.session.authenticated) {
      console.log(`[HubConnection] ⏰ Hub ${hubId}: auth timeout - hub did not send hub_hello within ${AUTH_TIMEOUT_MS}ms`);
      for (const ws of websockets) {
        this.sendError(ws, "AUTH_TIMEOUT", "Authentication timeout");
        ws.close(4001, "Authentication timeout");
      }
      await this.handleDisconnect();
      return;
    }

    // Check for heartbeat timeout
    if (this.session) {
      const timeSinceLastMessage = Date.now() - this.session.lastMessageAt;
      if (timeSinceLastMessage > HEARTBEAT_TIMEOUT_MS) {
        console.log(`[HubConnection] 💔 Hub ${hubId}: heartbeat timeout (no activity for ${Math.round(timeSinceLastMessage / 1000)}s)`);
        for (const ws of websockets) {
          ws.close(4002, "Heartbeat timeout");
        }
        await this.handleDisconnect();
        return;
      }
    }

    // Schedule next heartbeat check (silently - this is normal operation)
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
  }

  // ===========================================================================
  // MESSAGE HANDLERS
  // ===========================================================================

  /**
   * Handle hub_hello message - authenticate the hub
   */
  private async handleHubHello(ws: WebSocket, message: HubHelloMessage): Promise<void> {
    const storedHubId = await this.state.storage.get<string>("hubId");
    // Note: storedSecret would be used for HMAC verification in production
    // const storedSecret = await this.state.storage.get<string>("hubSecret");

    // Verify hub ID matches
    if (message.hub_id !== storedHubId) {
      this.sendError(ws, "HUB_ID_MISMATCH", "Hub ID does not match");
      ws.close(4003, "Hub ID mismatch");
      return;
    }

    // For now, we trust the hub if it knows its ID and connects
    // In production, you'd verify HMAC signature from query params
    // const isValid = await verifyHubSignature(message.hub_id, timestamp, signature, storedSecret!);

    // Mark as authenticated
    if (this.session) {
      this.session.authenticated = true;
      if (message.firmware_version) this.session.firmwareVersion = message.firmware_version;
      if (message.hardware_version) this.session.hardwareVersion = message.hardware_version;
      if (message.mac_address) this.session.macAddress = message.mac_address;
    }

    // Persist session data to storage (survives hibernation)
    await this.state.storage.put("sessionAuthenticated", true);
    await this.state.storage.put("sessionConnectedAt", this.session?.connectedAt || Date.now());
    await this.state.storage.put("sessionFirmwareVersion", message.firmware_version || null);
    await this.state.storage.put("sessionLastMessageAt", Date.now());

    // Update hub in database and fetch the hub name
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE hubs SET
        is_online = 1,
        last_seen_at = ?,
        firmware_version = ?,
        hardware_version = ?,
        mac_address = ?,
        updated_at = ?
      WHERE id = ?`
    )
      .bind(
        now,
        message.firmware_version || null,
        message.hardware_version || null,
        message.mac_address || null,
        now,
        storedHubId
      )
      .run();

    // Fetch the hub name from database to include in welcome message
    const hub = await this.env.DB.prepare(
      "SELECT name FROM hubs WHERE id = ?"
    )
      .bind(storedHubId)
      .first<{ name: string | null }>();

    // Send welcome response with hub name
    ws.send(
      JSON.stringify({
        type: "hub_welcome",
        hub_id: storedHubId,
        hub_name: hub?.name || null,
        tenant_id: this.session?.tenantId,
        server_time: Date.now(),
      })
    );

    // Schedule heartbeat alarm
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);

    // Broadcast hub online status to dashboard
    await this.broadcastHubStatus(true);

    console.log(`[HubConnection] ✅ Hub ${storedHubId} authenticated successfully (firmware: ${message.firmware_version || 'unknown'})`);
  }

  /**
   * Handle printer_status message - update printer status in database
   */
  private async handlePrinterStatus(ws: WebSocket, message: PrinterStatusMessage): Promise<void> {
    if (!this.session?.authenticated) {
      this.sendError(ws, "NOT_AUTHENTICATED", "Hub not authenticated");
      return;
    }

    const { printer_id, status, progress_percentage, remaining_time_seconds, current_layer, error_message } = message;

    const now = new Date().toISOString();

    // Update printer status in database
    // Note: printer_id from hub is the serial_number
    await this.env.DB.prepare(
      `UPDATE printers SET
        status = ?,
        is_connected = 1,
        connection_error = ?,
        updated_at = ?
      WHERE serial_number = ? AND tenant_id = ?`
    )
      .bind(
        status,
        error_message || null,
        now,
        printer_id,
        this.session.tenantId
      )
      .run();

    // Also update hub's last_seen_at
    await this.env.DB.prepare(
      "UPDATE hubs SET last_seen_at = ? WHERE id = ?"
    )
      .bind(now, this.session.hubId)
      .run();

    // Broadcast to dashboard
    await this.broadcastPrinterStatus(message);

    // If there's an active print job for this printer, update it too
    if (progress_percentage !== undefined) {
      await this.updateJobProgress(printer_id, progress_percentage, remaining_time_seconds, current_layer);
    }
  }

  /**
   * Handle file_progress message - update file transfer progress
   */
  private async handleFileProgress(ws: WebSocket, message: FileProgressMessage): Promise<void> {
    if (!this.session?.authenticated) {
      this.sendError(ws, "NOT_AUTHENTICATED", "Hub not authenticated");
      return;
    }

    const { job_id, stage, progress_percentage, error } = message;

    console.log(`[HubConnection] File progress: job=${job_id}, stage=${stage}, progress=${progress_percentage}%`);

    // Update job status based on stage
    const now = new Date().toISOString();

    if (stage === "downloading" || stage === "uploading") {
      // Job is being processed
      await this.env.DB.prepare(
        `UPDATE print_jobs SET status = 'processing', updated_at = ? WHERE id = ? AND tenant_id = ?`
      )
        .bind(now, job_id, this.session.tenantId)
        .run();
    } else if (stage === "complete") {
      // File uploaded, ready to print (or printing started)
      await this.env.DB.prepare(
        `UPDATE print_jobs SET status = 'uploaded', updated_at = ? WHERE id = ? AND tenant_id = ?`
      )
        .bind(now, job_id, this.session.tenantId)
        .run();
    } else if (stage === "failed") {
      // File transfer failed
      await this.env.DB.prepare(
        `UPDATE print_jobs SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
      )
        .bind(error || "File transfer failed", now, job_id, this.session.tenantId)
        .run();
    }

    // Broadcast to dashboard
    await this.broadcastJobProgress(job_id, stage, progress_percentage, error);
  }

  /**
   * Handle command_ack message - resolve pending command promise
   */
  private async handleCommandAck(_ws: WebSocket, message: CommandAckMessage): Promise<void> {
    const { command_id, success, error } = message;

    const pending = this.pendingCommands.get(command_id);
    if (pending) {
      // Clear timeout
      clearTimeout(pending.timeout);

      // Resolve promise - handle optional error properly
      const result: CommandResult = { success };
      if (error) result.error = error;
      pending.resolve(result);

      // Remove from pending
      this.pendingCommands.delete(command_id);

      console.log(`[HubConnection] Command ${command_id} acknowledged: success=${success}`);
    } else {
      console.warn(`[HubConnection] Received ack for unknown command: ${command_id}`);
    }
  }

  /**
   * Handle printer_discovered message - log discovered printers
   */
  private async handlePrinterDiscovered(ws: WebSocket, message: PrinterDiscoveredMessage): Promise<void> {
    if (!this.session?.authenticated) {
      this.sendError(ws, "NOT_AUTHENTICATED", "Hub not authenticated");
      return;
    }

    console.log(`[HubConnection] Discovered ${message.printers.length} printers`);

    // Store discovered printers for retrieval
    await this.state.storage.put("discoveredPrinters", message.printers);
    await this.state.storage.put("discoveredAt", Date.now());

    // Could broadcast to dashboard or store in KV for API retrieval
  }

  // ===========================================================================
  // DISCONNECT HANDLING
  // ===========================================================================

  /**
   * Handle hub disconnect - mark offline in database
   */
  private async handleDisconnect(): Promise<void> {
    const hubId = await this.state.storage.get<string>("hubId");
    const tenantId = await this.state.storage.get<string>("tenantId");

    if (!hubId) return;

    const sessionDuration = this.session?.connectedAt
      ? Math.round((Date.now() - this.session.connectedAt) / 1000)
      : 0;
    console.log(`[HubConnection] 📴 Hub ${hubId} disconnected (session duration: ${sessionDuration}s)`);

    const now = new Date().toISOString();

    // Mark hub as offline
    await this.env.DB.prepare(
      `UPDATE hubs SET is_online = 0, last_seen_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(now, now, hubId)
      .run();

    // Mark all printers connected to this hub as disconnected
    await this.env.DB.prepare(
      `UPDATE printers SET is_connected = 0, status = 'offline', updated_at = ? WHERE hub_id = ?`
    )
      .bind(now, hubId)
      .run();

    // Reject all pending commands
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Hub disconnected"));
    }
    this.pendingCommands.clear();

    // Clear session (both in-memory and storage)
    this.session = null;
    await this.state.storage.delete("sessionAuthenticated");
    await this.state.storage.delete("sessionConnectedAt");
    await this.state.storage.delete("sessionLastMessageAt");
    await this.state.storage.delete("sessionFirmwareVersion");

    // Broadcast hub offline status
    if (tenantId) {
      await this.broadcastHubStatus(false);
    }

    // Cancel alarm
    await this.state.storage.deleteAlarm();
  }

  // ===========================================================================
  // COMMAND HANDLING (FROM API)
  // ===========================================================================

  /**
   * Handle internal command request from API routes
   */
  private async handleCommandRequest(request: Request): Promise<Response> {
    let body: InternalRequest;
    try {
      body = (await request.json()) as InternalRequest;
    } catch {
      return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }

    if (body.action === "get_status") {
      return this.handleStatusRequest();
    }

    if (body.action === "send_command") {
      return this.handleSendCommand(body);
    }

    return Response.json({ success: false, error: "Unknown action" }, { status: 400 });
  }

  /**
   * Send a command to the hub and optionally wait for acknowledgment
   */
  private async handleSendCommand(request: InternalCommand): Promise<Response> {
    const websockets = this.state.getWebSockets();

    if (websockets.length === 0) {
      return Response.json(
        { success: false, error: "Hub not connected" },
        { status: 503 }
      );
    }

    // After hibernation wake-up, this.session may be null even though
    // the session data is persisted in storage. Restore it if needed.
    await this.ensureSessionRestored();

    if (!this.session?.authenticated) {
      return Response.json(
        { success: false, error: "Hub not authenticated" },
        { status: 503 }
      );
    }

    const command = request.command;
    const commandId = "command_id" in command ? command.command_id : generateId();

    // Send command to hub
    const ws = websockets[0];
    if (!ws) {
      return Response.json(
        { success: false, error: "WebSocket not available" },
        { status: 503 }
      );
    }
    ws.send(JSON.stringify(command));

    console.log(`[HubConnection] Sent command: ${command.type}, id=${commandId}`);

    // If not waiting for ack, return immediately
    if (!request.waitForAck) {
      return Response.json({ success: true, command_id: commandId });
    }

    // Wait for acknowledgment
    const timeout = request.timeout || COMMAND_TIMEOUT_MS;

    try {
      const result = await new Promise<CommandResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pendingCommands.delete(commandId);
          reject(new Error("Command timeout"));
        }, timeout);

        this.pendingCommands.set(commandId, {
          commandId,
          type: command.type,
          resolve,
          reject,
          timeout: timeoutId as unknown as number,
          createdAt: Date.now(),
        });
      });

      return Response.json({ success: result.success, command_id: commandId, error: result.error });
    } catch (error) {
      return Response.json(
        { success: false, command_id: commandId, error: error instanceof Error ? error.message : "Unknown error" },
        { status: 504 }
      );
    }
  }

  /**
   * Get hub connection status
   */
  private async handleStatusRequest(): Promise<Response> {
    const hubId = await this.state.storage.get<string>("hubId");
    const tenantId = await this.state.storage.get<string>("tenantId");
    const websockets = this.state.getWebSockets();

    // Read session data from storage (survives hibernation)
    // In-memory this.session may be null after hibernation wake-up
    const sessionAuthenticated = await this.state.storage.get<boolean>("sessionAuthenticated") || false;
    const sessionConnectedAt = await this.state.storage.get<number>("sessionConnectedAt");
    const sessionLastMessageAt = await this.state.storage.get<number>("sessionLastMessageAt");
    const sessionFirmwareVersion = await this.state.storage.get<string | null>("sessionFirmwareVersion");

    const isConnected = websockets.length > 0;
    // Only consider authenticated if both connected AND was authenticated
    const isAuthenticated = isConnected && sessionAuthenticated;

    return Response.json({
      success: true,
      data: {
        hub_id: hubId,
        tenant_id: tenantId,
        connected: isConnected,
        authenticated: isAuthenticated,
        connected_at: sessionConnectedAt,
        last_message_at: sessionLastMessageAt,
        firmware_version: sessionFirmwareVersion,
        pending_commands: this.pendingCommands.size,
      },
    });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Restore session state from storage after hibernation wake-up.
   *
   * When a Durable Object hibernates, the in-memory this.session is lost.
   * This method restores it from persistent storage if there's an active
   * WebSocket connection with valid session data.
   */
  private async ensureSessionRestored(): Promise<void> {
    // If session is already in memory, nothing to do
    if (this.session) {
      return;
    }

    // Check if we have persisted session data
    const sessionAuthenticated = await this.state.storage.get<boolean>("sessionAuthenticated");
    if (!sessionAuthenticated) {
      return; // No valid session in storage
    }

    // Restore session from storage
    const hubId = await this.state.storage.get<string>("hubId");
    const tenantId = await this.state.storage.get<string>("tenantId");
    const sessionConnectedAt = await this.state.storage.get<number>("sessionConnectedAt");
    const sessionLastMessageAt = await this.state.storage.get<number>("sessionLastMessageAt");
    const sessionFirmwareVersion = await this.state.storage.get<string | null>("sessionFirmwareVersion");

    if (hubId && tenantId) {
      this.session = {
        hubId,
        tenantId,
        authenticated: true,
        connectedAt: sessionConnectedAt || Date.now(),
        lastMessageAt: sessionLastMessageAt || Date.now(),
      };
      if (sessionFirmwareVersion) {
        this.session.firmwareVersion = sessionFirmwareVersion;
      }
      console.log(`[HubConnection] 🔄 Session restored from storage for hub ${hubId}`);
    }
  }

  /**
   * Send error message to WebSocket
   */
  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(
      JSON.stringify({
        type: "error",
        code,
        message,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Update job progress in database
   */
  private async updateJobProgress(
    printerSerialNumber: string,
    progress: number,
    _remainingSeconds?: number,
    _currentLayer?: number
  ): Promise<void> {
    if (!this.session) return;

    const now = new Date().toISOString();

    // Find active job for this printer
    const job = await this.env.DB.prepare(
      `SELECT j.id FROM print_jobs j
      JOIN printers p ON j.printer_id = p.id
      WHERE p.serial_number = ? AND j.tenant_id = ? AND j.status IN ('printing', 'uploaded')
      ORDER BY j.time_started DESC LIMIT 1`
    )
      .bind(printerSerialNumber, this.session.tenantId)
      .first<{ id: string }>();

    if (job) {
      await this.env.DB.prepare(
        `UPDATE print_jobs SET
          progress_percentage = ?,
          status = 'printing',
          updated_at = ?
        WHERE id = ?`
      )
        .bind(progress, now, job.id)
        .run();
    }
  }

  /**
   * Broadcast hub status to DashboardBroadcast DO
   */
  private async broadcastHubStatus(isOnline: boolean): Promise<void> {
    if (!this.session) return;

    try {
      const doId = this.env.DASHBOARD_BROADCASTS.idFromName(this.session.tenantId);
      const stub = this.env.DASHBOARD_BROADCASTS.get(doId);

      await stub.fetch("http://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "hub_status",
          hub_id: this.session.hubId,
          is_online: isOnline,
        }),
      });
    } catch (error) {
      console.error("[HubConnection] Failed to broadcast hub status:", error);
    }
  }

  /**
   * Broadcast printer status to DashboardBroadcast DO
   */
  private async broadcastPrinterStatus(status: PrinterStatusMessage): Promise<void> {
    if (!this.session) return;

    try {
      const doId = this.env.DASHBOARD_BROADCASTS.idFromName(this.session.tenantId);
      const stub = this.env.DASHBOARD_BROADCASTS.get(doId);

      await stub.fetch("http://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "printer_status",
          printer_id: status.printer_id,
          status: status.status,
          progress_percentage: status.progress_percentage,
          remaining_time_seconds: status.remaining_time_seconds,
        }),
      });
    } catch (error) {
      console.error("[HubConnection] Failed to broadcast printer status:", error);
    }
  }

  /**
   * Broadcast job progress to DashboardBroadcast DO
   */
  private async broadcastJobProgress(
    jobId: string,
    stage: string,
    progress: number,
    error?: string
  ): Promise<void> {
    if (!this.session) return;

    try {
      const doId = this.env.DASHBOARD_BROADCASTS.idFromName(this.session.tenantId);
      const stub = this.env.DASHBOARD_BROADCASTS.get(doId);

      await stub.fetch("http://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "job_update",
          job_id: jobId,
          stage,
          progress_percentage: progress,
          error,
        }),
      });
    } catch (error) {
      console.error("[HubConnection] Failed to broadcast job progress:", error);
    }
  }
}
