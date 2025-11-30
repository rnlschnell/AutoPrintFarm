/**
 * DashboardBroadcast Durable Object
 *
 * Manages WebSocket connections for real-time dashboard updates.
 * One instance per tenant, broadcasting status updates to all connected clients.
 *
 * Responsibilities:
 * - Maintain WebSocket connections to dashboard clients
 * - Authenticate clients via session token
 * - Handle subscription to specific printers
 * - Broadcast printer status updates to subscribed clients
 * - Broadcast job updates, hub status changes, inventory alerts, new orders
 * - Handle client disconnection cleanup
 *
 * WebSocket Protocol:
 * - Client -> Server: auth, subscribe
 * - Server -> Client: auth_success, auth_error, printer_status, job_update, hub_status, inventory_alert, new_order
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "../types/env";
import type {
  DashboardClientMessage,
  DashboardServerMessage,
  DashboardAuthMessage,
  DashboardSubscribeMessage,
  DashboardPrinterStatusMessage,
  DashboardJobUpdateMessage,
  DashboardHubStatusMessage,
  DashboardInventoryAlertMessage,
  DashboardNewOrderMessage,
} from "../types";

// =============================================================================
// TYPES
// =============================================================================

interface ClientSession {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  authenticatedAt: number;
  subscribedPrinters: Set<string>; // Printer IDs the client wants updates for
}

// Serializable version for WebSocket attachment (survives hibernation)
interface SerializableSession {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  authenticatedAt: number;
  subscribedPrinters: string[]; // Array, not Set (must be JSON-serializable)
}

interface StoredSession {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
}

interface StoredUser {
  id: string;
  email: string;
  full_name: string;
}

interface TenantMembership {
  id: string;
  role: string;
}

// Broadcast message types received from HubConnection or queues
interface BroadcastMessage {
  type: string;
  [key: string]: unknown;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const AUTH_TIMEOUT_MS = 30_000; // 30 seconds to authenticate after connect
const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds - check for stale connections
const MAX_CLIENTS_PER_TENANT = 100; // Maximum concurrent clients per tenant

// =============================================================================
// DASHBOARD BROADCAST DURABLE OBJECT
// =============================================================================

export class DashboardBroadcast {
  readonly state: DurableObjectState;
  readonly env: Env;

  // Map of WebSocket -> ClientSession for authenticated clients
  private clientSessions: Map<WebSocket, ClientSession> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ===========================================================================
  // FETCH HANDLER
  // ===========================================================================

  /**
   * Handle incoming HTTP requests to this Durable Object
   * - WebSocket upgrade requests for dashboard connections
   * - Internal broadcast requests from HubConnection or queues
   * - Status endpoint for monitoring
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade request
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Internal broadcast endpoint (called by HubConnection and queues)
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcastRequest(request);
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
   * Handle WebSocket upgrade request from dashboard client
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract tenant ID from query parameter
    const tenantId = url.searchParams.get("tenant");

    if (!tenantId) {
      return new Response("Tenant ID required", { status: 400 });
    }

    // Check client limit
    const websockets = this.state.getWebSockets();
    if (websockets.length >= MAX_CLIENTS_PER_TENANT) {
      return new Response("Too many connections", { status: 503 });
    }

    // Store tenant ID if not already set
    const storedTenantId = await this.state.storage.get<string>("tenantId");
    if (!storedTenantId) {
      await this.state.storage.put("tenantId", tenantId);
    }

    // Create WebSocket pair
    const { 0: client, 1: server } = new WebSocketPair();

    // Accept the WebSocket connection using hibernation API
    // Tag with "unauthenticated" until client sends auth message
    this.state.acceptWebSocket(server, ["unauthenticated"]);

    console.log(`[DashboardBroadcast] WebSocket upgrade for tenant ${tenantId}`);

    // Schedule auth timeout alarm
    const nextAlarm = await this.state.storage.getAlarm();
    if (!nextAlarm) {
      await this.state.storage.setAlarm(Date.now() + AUTH_TIMEOUT_MS);
    }

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
    // Restore sessions from attachments if needed (after hibernation wake-up)
    this.ensureSessionsRestored();

    // Parse message
    let data: DashboardClientMessage;
    try {
      const messageStr = typeof message === "string" ? message : new TextDecoder().decode(message);
      data = JSON.parse(messageStr) as DashboardClientMessage;
    } catch (error) {
      console.error("[DashboardBroadcast] Failed to parse message:", error);
      this.sendError(ws, "INVALID_MESSAGE", "Failed to parse message");
      return;
    }

    console.log(`[DashboardBroadcast] Received message: ${data.type}`);

    // Route to appropriate handler
    switch (data.type) {
      case "auth":
        await this.handleAuthMessage(ws, data as DashboardAuthMessage);
        break;
      case "subscribe":
        await this.handleSubscribeMessage(ws, data as DashboardSubscribeMessage);
        break;
      default:
        console.warn(`[DashboardBroadcast] Unknown message type: ${(data as DashboardClientMessage).type}`);
        this.sendError(ws, "UNKNOWN_MESSAGE_TYPE", "Unknown message type");
    }
  }

  /**
   * Called when WebSocket is closed (hibernation API)
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    console.log(`[DashboardBroadcast] WebSocket closed`);
    this.cleanupClient(ws);
  }

  /**
   * Called when WebSocket encounters an error (hibernation API)
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("[DashboardBroadcast] WebSocket error:", error);
    this.cleanupClient(ws);
  }

  /**
   * Alarm handler for auth timeouts and cleanup
   */
  async alarm(): Promise<void> {
    console.log("[DashboardBroadcast] Alarm triggered");

    // Restore sessions from attachments first
    this.ensureSessionsRestored();

    const websockets = this.state.getWebSockets();

    // Check for unauthenticated connections that have timed out
    for (const ws of websockets) {
      // Check if client has a valid session (authenticated)
      // We use the session map instead of tags since tags can't be updated after acceptWebSocket
      const session = this.clientSessions.get(ws);

      // If no session exists, the client hasn't authenticated yet
      if (!session) {
        console.log("[DashboardBroadcast] Closing unauthenticated connection");
        this.sendAuthError(ws, "Authentication timeout");
        ws.close(4001, "Authentication timeout");
        this.cleanupClient(ws);
      }
    }

    // Schedule next alarm if there are still connections
    const remainingWebsockets = this.state.getWebSockets();
    if (remainingWebsockets.length > 0) {
      await this.state.storage.setAlarm(now + HEARTBEAT_INTERVAL_MS);
    }
  }

  // ===========================================================================
  // MESSAGE HANDLERS
  // ===========================================================================

  /**
   * Handle auth message - validate session token and authenticate client
   */
  private async handleAuthMessage(ws: WebSocket, message: DashboardAuthMessage): Promise<void> {
    const { token } = message;

    if (!token) {
      this.sendAuthError(ws, "Token required");
      return;
    }

    try {
      // Look up session by token
      const session = await this.env.DB.prepare(
        "SELECT id, user_id, token, expires_at FROM sessions WHERE token = ?"
      )
        .bind(token)
        .first<StoredSession>();

      if (!session) {
        this.sendAuthError(ws, "Invalid session token");
        return;
      }

      // Check if session is expired
      const expiresAt = new Date(session.expires_at).getTime();
      if (expiresAt < Date.now()) {
        this.sendAuthError(ws, "Session expired");
        return;
      }

      // Get user info
      const user = await this.env.DB.prepare(
        "SELECT id, email, full_name FROM users WHERE id = ?"
      )
        .bind(session.user_id)
        .first<StoredUser>();

      if (!user) {
        this.sendAuthError(ws, "User not found");
        return;
      }

      // Get tenant ID from storage
      const tenantId = await this.state.storage.get<string>("tenantId");
      if (!tenantId) {
        this.sendAuthError(ws, "Tenant not configured");
        return;
      }

      // Verify user is a member of this tenant
      const membership = await this.env.DB.prepare(
        "SELECT id, role FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND is_active = 1"
      )
        .bind(tenantId, user.id)
        .first<TenantMembership>();

      if (!membership) {
        this.sendAuthError(ws, "User is not a member of this tenant");
        return;
      }

      // Create client session
      const clientSession: ClientSession = {
        userId: user.id,
        userEmail: user.email,
        userName: user.full_name,
        tenantId,
        authenticatedAt: Date.now(),
        subscribedPrinters: new Set(),
      };

      // Store session in memory for quick access
      this.clientSessions.set(ws, clientSession);

      // Persist session to WebSocket attachment (survives hibernation)
      this.attachSessionToWebSocket(ws, clientSession);

      // Send success response
      const response: DashboardServerMessage = {
        type: "auth_success",
      };
      ws.send(JSON.stringify(response));

      console.log(`[DashboardBroadcast] Client authenticated: ${user.email}`);
    } catch (error) {
      console.error("[DashboardBroadcast] Auth error:", error);
      this.sendAuthError(ws, "Authentication failed");
    }
  }

  /**
   * Handle subscribe message - update printer subscriptions
   */
  private async handleSubscribeMessage(ws: WebSocket, message: DashboardSubscribeMessage): Promise<void> {
    const session = this.clientSessions.get(ws);

    if (!session) {
      this.sendError(ws, "NOT_AUTHENTICATED", "Must authenticate before subscribing");
      return;
    }

    const { printers, unsubscribe } = message;

    if (!printers || !Array.isArray(printers)) {
      // Subscribe to all printers (empty set means no filtering)
      if (unsubscribe) {
        session.subscribedPrinters.clear();
        console.log(`[DashboardBroadcast] Client unsubscribed from all printers`);
      } else {
        session.subscribedPrinters.clear(); // Empty set = subscribe to all
        console.log(`[DashboardBroadcast] Client subscribed to all printers`);
      }
      // Persist subscription change to WebSocket attachment
      this.attachSessionToWebSocket(ws, session);
      return;
    }

    if (unsubscribe) {
      // Remove printers from subscription
      for (const printerId of printers) {
        session.subscribedPrinters.delete(printerId);
      }
      console.log(`[DashboardBroadcast] Client unsubscribed from ${printers.length} printers`);
    } else {
      // Add printers to subscription
      for (const printerId of printers) {
        session.subscribedPrinters.add(printerId);
      }
      console.log(`[DashboardBroadcast] Client subscribed to ${printers.length} printers`);
    }

    // Persist subscription change to WebSocket attachment
    this.attachSessionToWebSocket(ws, session);
  }

  // ===========================================================================
  // BROADCAST HANDLING
  // ===========================================================================

  /**
   * Handle internal broadcast request from HubConnection or queues
   */
  private async handleBroadcastRequest(request: Request): Promise<Response> {
    let message: BroadcastMessage;
    try {
      message = (await request.json()) as BroadcastMessage;
    } catch {
      return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }

    const broadcastCount = await this.broadcastToClients(message);

    return Response.json({
      success: true,
      clients_reached: broadcastCount,
    });
  }

  /**
   * Broadcast a message to all relevant clients
   */
  private async broadcastToClients(message: BroadcastMessage): Promise<number> {
    // Restore sessions from attachments if needed (after hibernation wake-up)
    this.ensureSessionsRestored();

    const websockets = this.state.getWebSockets();
    let broadcastCount = 0;

    for (const ws of websockets) {
      const session = this.clientSessions.get(ws);

      // Skip unauthenticated clients
      if (!session) {
        continue;
      }

      // Check if this message should be sent to this client
      if (this.shouldSendToClient(session, message)) {
        try {
          ws.send(JSON.stringify(message));
          broadcastCount++;
        } catch (error) {
          console.error("[DashboardBroadcast] Failed to send to client:", error);
          // Client may be disconnected, cleanup will happen in webSocketClose
        }
      }
    }

    console.log(`[DashboardBroadcast] Broadcast ${message.type} to ${broadcastCount} clients`);
    return broadcastCount;
  }

  /**
   * Determine if a message should be sent to a specific client based on subscriptions
   */
  private shouldSendToClient(session: ClientSession, message: BroadcastMessage): boolean {
    // Hub status and inventory alerts are always sent to all authenticated clients
    if (
      message.type === "hub_status" ||
      message.type === "inventory_alert" ||
      message.type === "new_order"
    ) {
      return true;
    }

    // For printer_status and job_update, check printer subscription
    if (message.type === "printer_status" || message.type === "job_update") {
      const printerId = message.printer_id as string | undefined;

      // If client has no specific subscriptions, they get all updates
      if (session.subscribedPrinters.size === 0) {
        return true;
      }

      // If message has a printer_id, check if client is subscribed
      if (printerId && session.subscribedPrinters.has(printerId)) {
        return true;
      }

      // For job updates without printer_id, send to all (queue/waiting jobs)
      if (message.type === "job_update" && !printerId) {
        return true;
      }

      return false;
    }

    // Default: send to all authenticated clients
    return true;
  }

  // ===========================================================================
  // STATUS ENDPOINT
  // ===========================================================================

  /**
   * Get dashboard connection status
   */
  private async handleStatusRequest(): Promise<Response> {
    const tenantId = await this.state.storage.get<string>("tenantId");
    const websockets = this.state.getWebSockets();

    const authenticatedCount = this.clientSessions.size;
    const unauthenticatedCount = websockets.length - authenticatedCount;

    // Get subscription stats
    const subscriptionStats: Record<string, number> = {};
    for (const [, session] of this.clientSessions) {
      if (session.subscribedPrinters.size === 0) {
        subscriptionStats["all_printers"] = (subscriptionStats["all_printers"] || 0) + 1;
      } else {
        for (const printerId of session.subscribedPrinters) {
          subscriptionStats[printerId] = (subscriptionStats[printerId] || 0) + 1;
        }
      }
    }

    return Response.json({
      success: true,
      data: {
        tenant_id: tenantId,
        total_connections: websockets.length,
        authenticated_connections: authenticatedCount,
        unauthenticated_connections: unauthenticatedCount,
        subscription_stats: subscriptionStats,
        max_clients: MAX_CLIENTS_PER_TENANT,
      },
    });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Restore client sessions from WebSocket attachments after hibernation wake-up.
   *
   * When a Durable Object hibernates, the in-memory clientSessions Map is lost.
   * This method restores it from WebSocket attachments which survive hibernation.
   */
  private ensureSessionsRestored(): void {
    const websockets = this.state.getWebSockets();
    for (const ws of websockets) {
      // Skip if we already have this session in memory
      if (this.clientSessions.has(ws)) {
        continue;
      }

      // Try to restore from WebSocket attachment
      try {
        const attachment = ws.deserializeAttachment() as SerializableSession | null;
        if (attachment && attachment.userId) {
          // Restore session with Set instead of Array
          const clientSession: ClientSession = {
            userId: attachment.userId,
            userEmail: attachment.userEmail,
            userName: attachment.userName,
            tenantId: attachment.tenantId,
            authenticatedAt: attachment.authenticatedAt,
            subscribedPrinters: new Set(attachment.subscribedPrinters || []),
          };
          this.clientSessions.set(ws, clientSession);
          console.log(`[DashboardBroadcast] Session restored from attachment for user ${attachment.userEmail}`);
        }
      } catch (error) {
        // Attachment may not exist or be invalid - this is fine for unauthenticated connections
        console.log(`[DashboardBroadcast] No valid session attachment found for WebSocket`);
      }
    }
  }

  /**
   * Serialize and attach session to WebSocket (survives hibernation)
   */
  private attachSessionToWebSocket(ws: WebSocket, session: ClientSession): void {
    const serializableSession: SerializableSession = {
      userId: session.userId,
      userEmail: session.userEmail,
      userName: session.userName,
      tenantId: session.tenantId,
      authenticatedAt: session.authenticatedAt,
      subscribedPrinters: Array.from(session.subscribedPrinters),
    };
    ws.serializeAttachment(serializableSession);
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
   * Send auth error message
   */
  private sendAuthError(ws: WebSocket, error: string): void {
    const response: DashboardServerMessage = {
      type: "auth_error",
      error,
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * Clean up client session on disconnect
   */
  private cleanupClient(ws: WebSocket): void {
    this.clientSessions.delete(ws);
  }

  // ===========================================================================
  // PUBLIC BROADCAST METHODS (for external callers)
  // ===========================================================================

  /**
   * Get the tenant ID (used by external callers)
   */
  async getTenantId(): Promise<string | undefined> {
    return await this.state.storage.get<string>("tenantId");
  }
}

// =============================================================================
// TYPE EXPORTS (for use by broadcast helpers)
// =============================================================================

export type {
  DashboardPrinterStatusMessage,
  DashboardJobUpdateMessage,
  DashboardHubStatusMessage,
  DashboardInventoryAlertMessage,
  DashboardNewOrderMessage,
};
