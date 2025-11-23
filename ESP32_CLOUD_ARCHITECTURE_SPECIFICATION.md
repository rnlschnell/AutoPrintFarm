# ESP32 Cloud Architecture Specification
# Print Farm Management System

> **Related Documentation**: This document focuses on ESP32 hub hardware and firmware.
> See `PRINTFARM_CLOUD_ARCHITECTURE.md` for the complete system architecture, D1 schema, and feature documentation.

## Executive Summary

This document specifies a cloud-native print farm management system using ESP32 microcontrollers as local hubs that bridge 3D printers to a centralized cloud platform. The architecture prioritizes:

- **Simplicity**: Users plug in a hub, pair via Bluetooth, and start managing printers
- **Reliability**: Cloud infrastructure handles all business logic with 99.9%+ uptime
- **Scalability**: From 1 printer to 10,000+ with the same architecture
- **Maintainability**: All software updates happen in the cloud, zero local maintenance

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│   │   Cloudflare │    │   Cloudflare │    │   Cloudflare │                  │
│   │     Pages    │    │    Workers   │    │   Durable    │                  │
│   │  (Frontend)  │    │    (API)     │    │   Objects    │                  │
│   └──────────────┘    └──────────────┘    └──────────────┘                  │
│          │                   │                   │                           │
│          └───────────────────┼───────────────────┘                           │
│                              │                                               │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│   │  Cloudflare  │    │  Cloudflare  │    │  Cloudflare  │                  │
│   │      D1      │    │      R2      │    │     KV       │                  │
│   │  (Database)  │    │   (Storage)  │    │   (Cache)    │                  │
│   └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (wss://)
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CUSTOMER LOCATION                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│   │    ESP32     │  MQTT   │   Bambu X1   │         │   Bambu P1   │        │
│   │     Hub      │◄───────►│    Printer   │         │    Printer   │        │
│   │              │         └──────────────┘         └──────────────┘        │
│   │  (5 Ports)   │  MQTT          │                        │                │
│   │              │◄───────────────┴────────────────────────┘                │
│   └──────────────┘                                                          │
│         │                                                                    │
│         │ WiFi                                                               │
│         ▼                                                                    │
│   ┌──────────────┐                                                          │
│   │    Router    │───────────────► Internet                                 │
│   └──────────────┘                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. ESP32 Hub Hardware

#### Hardware Requirements

| Component | Specification | Purpose |
|-----------|---------------|---------|
| MCU | ESP32-S3-WROOM-1 | WiFi, Bluetooth, processing |
| Flash | 16MB | Firmware, certificates, config |
| RAM | 512KB SRAM + 8MB PSRAM | MQTT buffers, file staging |
| WiFi | 802.11 b/g/n 2.4GHz | Cloud connectivity |
| Bluetooth | BLE 5.0 | Initial pairing/config |
| Power | 5V 2A USB-C | Simple power delivery |
| Status LEDs | 3x RGB | Connection status indication |
| Enclosure | Compact injection-molded | ~50mm x 50mm x 20mm |

#### Bill of Materials (Estimated)

| Item | Cost |
|------|------|
| ESP32-S3-WROOM-1 Module | $4.00 |
| PCB + Components | $3.00 |
| USB-C Connector + Power Regulation | $1.50 |
| LEDs + Resistors | $0.50 |
| Enclosure | $2.00 |
| Assembly + Testing | $4.00 |
| **Total Manufacturing Cost** | **~$15.00** |
| **Retail Price Target** | **$39-49** |

#### LED Status Indicators

| LED | State | Meaning |
|-----|-------|---------|
| Power (White) | Solid | Power on |
| Cloud (Blue) | Off | Not connected |
| Cloud (Blue) | Blinking | Connecting |
| Cloud (Blue) | Solid | Connected |
| Printers (Green) | Off | No printers |
| Printers (Green) | Blinking | Connecting to printers |
| Printers (Green) | Solid | All printers connected |
| Any (Red) | Blinking | Error condition |

---

### 2. ESP32 Firmware Architecture

#### Firmware Components

```
┌─────────────────────────────────────────────────────────┐
│                    ESP32 Firmware                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   WiFi       │  │  Bluetooth   │  │   Config     │   │
│  │   Manager    │  │   Manager    │  │   Storage    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  WebSocket   │  │    MQTT      │  │   Protocol   │   │
│  │   Client     │  │   Manager    │  │   Bridge     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │    OTA       │  │   Watchdog   │  │    Status    │   │
│  │   Updater    │  │   Manager    │  │   Reporter   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Core Responsibilities

The ESP32 firmware has a single purpose: **Bridge communication between printers and cloud**

1. **WiFi Manager**
   - Store WiFi credentials in NVS (Non-Volatile Storage)
   - Auto-reconnect on connection loss
   - Support WPA2/WPA3 Enterprise (optional)
   - Captive portal fallback for reconfiguration

2. **Bluetooth Manager**
   - BLE GATT server for initial pairing
   - Advertise device ID and firmware version
   - Accept WiFi credentials from mobile app/browser
   - Accept hub claim token from cloud

3. **Config Storage**
   - NVS for persistent configuration
   - Hub ID (UUID, factory-provisioned)
   - WiFi credentials (encrypted)
   - Cloud endpoint URL
   - Printer configurations
   - TLS certificates

4. **WebSocket Client**
   - Persistent WSS connection to cloud
   - Automatic reconnection with exponential backoff
   - Heartbeat/ping-pong for connection health
   - Binary message support for efficiency

5. **MQTT Manager** (Bambu Lab Printers)
   - Connect to up to 5 Bambu printers simultaneously via MQTT over TLS (port 8883)
   - Handle Bambu's TLS requirements and authentication
   - Subscribe to `device/{serial}/report` for status updates
   - Publish to `device/{serial}/request` for commands
   - Parse printer status messages (gcode_state, progress, layer, temperature, etc.)

6. **FTP Manager** (Bambu Lab File Transfers)
   - FTPS connection to Bambu printers (port 990)
   - Download 3MF files from cloud (R2 presigned URL)
   - Upload files to printer's SD card
   - Chunked transfer for large files (3MF can be 5-50MB)
   - Progress reporting to cloud
   - Resume/retry on connection interruption

7. **Protocol Bridge**
   - Translate cloud commands → MQTT/FTP operations
   - Translate MQTT status → cloud messages
   - Queue messages when connectivity is interrupted
   - Handle message ordering and deduplication
   - Protocol abstraction for future printer support (Prusa HTTP, OctoPrint, Klipper)

8. **OTA Updater**
   - Check for firmware updates on cloud connect
   - Download and verify firmware images
   - Dual-partition OTA for rollback safety
   - Report update status to cloud

9. **Watchdog Manager**
   - Hardware watchdog for crash recovery
   - Software watchdog for task monitoring
   - Automatic restart on hung tasks
   - Crash reporting to cloud

#### Firmware State Machine

```
                    ┌─────────────┐
                    │   BOOT      │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
               ┌────│  INIT_NVS   │
               │    └──────┬──────┘
               │           │
    ┌──────────▼──────┐    │ Has Config?
    │  BLUETOOTH_PAIR │◄───┴── No
    └────────┬────────┘
             │ Received Config
    ┌────────▼────────┐
    │  WIFI_CONNECT   │◄─────────────────┐
    └────────┬────────┘                  │
             │ Connected                  │
    ┌────────▼────────┐                  │
    │  CLOUD_CONNECT  │                  │
    └────────┬────────┘                  │
             │ Connected                  │
    ┌────────▼────────┐                  │
    │  MQTT_CONNECT   │                  │
    └────────┬────────┘                  │
             │ Printers Connected         │
    ┌────────▼────────┐                  │
    │    RUNNING      │──── Error ───────┘
    └─────────────────┘
```

#### Message Protocol (Hub ↔ Cloud)

All messages are JSON over WebSocket with binary support for file transfers.

**Hub → Cloud Messages:**

```typescript
// Hub identification on connect
interface HubHello {
  type: "hub_hello";
  hub_id: string;           // Factory-provisioned UUID
  firmware_version: string;
  hardware_revision: string;
  uptime_seconds: number;
  free_heap: number;
}

// Printer status update
interface PrinterStatus {
  type: "printer_status";
  printer_id: string;       // Serial number
  status: {
    state: "idle" | "printing" | "paused" | "error" | "offline";
    progress_percent?: number;
    layer_current?: number;
    layer_total?: number;
    time_remaining_minutes?: number;
    temperatures: {
      nozzle: number;
      bed: number;
      chamber?: number;
    };
    ams_status?: AMSStatus[];
    current_file?: string;
    error_code?: string;
  };
  timestamp: number;
}

// Command acknowledgment
interface CommandAck {
  type: "command_ack";
  command_id: string;
  success: boolean;
  error_message?: string;
}

// File transfer progress
interface FileProgress {
  type: "file_progress";
  transfer_id: string;
  bytes_sent: number;
  bytes_total: number;
}
```

**Cloud → Hub Messages:**

```typescript
// Cloud acknowledgment
interface CloudHello {
  type: "cloud_hello";
  session_id: string;
  server_time: number;
  firmware_update_available?: {
    version: string;
    url: string;
    checksum: string;
  };
}

// Configure printer connection
interface ConfigurePrinter {
  type: "configure_printer";
  command_id: string;
  action: "add" | "remove" | "update";
  printer: {
    serial_number: string;
    ip_address: string;
    access_code: string;
    name: string;
  };
}

// Send print command
interface PrintCommand {
  type: "print_command";
  command_id: string;
  printer_id: string;
  action: "start" | "pause" | "resume" | "stop";
  file_url?: string;        // R2 presigned URL for start
  file_name?: string;
}

// Request printer discovery
interface DiscoverPrinters {
  type: "discover_printers";
  command_id: string;
}

// Generic printer passthrough
interface PrinterPassthrough {
  type: "printer_passthrough";
  command_id: string;
  printer_id: string;
  mqtt_topic: string;
  mqtt_payload: object;
}
```

---

### 3. Cloud Platform Architecture

#### Cloudflare Services Utilized

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Pages** | Static frontend hosting | React SPA with SSR support |
| **Workers** | API endpoints | Edge-deployed serverless functions |
| **Durable Objects** | WebSocket management, state | Per-hub and per-user instances |
| **D1** | Primary database | SQLite-compatible, replicated |
| **R2** | File storage | G-code files, images, exports |
| **KV** | Cache layer | Session tokens, config cache |
| **Queues** | Background jobs | Email, webhooks, analytics |
| **Analytics Engine** | Telemetry | Usage metrics, error tracking |

#### Database Schema (D1)

> **Note**: The complete D1 database schema is documented in `PRINTFARM_CLOUD_ARCHITECTURE.md`.
> This section provides a summary of the hub-relevant tables.

**Key Design Decisions**:
- Multi-tenancy via `tenant_id` column on all tables
- All timestamps stored as INTEGER (Unix epoch milliseconds)
- UUIDs stored as TEXT
- Booleans stored as INTEGER (0/1)

**Hub-Relevant Tables**:

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant organizations |
| `users` | User accounts |
| `tenant_members` | User-tenant membership with roles (owner, admin, operator, viewer) |
| `hubs` | ESP32 hub registration and status |
| `printers` | Printer configuration, status, and maintenance tracking |
| `print_files` | 3MF file metadata and R2 references |
| `print_jobs` | Print job queue, progress, and history |
| `cameras` | Camera configurations linked to printers/hubs |

**Hub Table Schema** (for reference):
```sql
CREATE TABLE hubs (
    id TEXT PRIMARY KEY,           -- Factory-provisioned UUID
    tenant_id TEXT,                -- NULL until claimed
    name TEXT,
    firmware_version TEXT,
    hardware_revision TEXT,
    last_seen_at INTEGER,
    is_online INTEGER DEFAULT 0,
    local_ip_address TEXT,
    wifi_signal_strength INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE INDEX idx_hubs_tenant ON hubs(tenant_id);
CREATE INDEX idx_hubs_online ON hubs(is_online);
```

See `PRINTFARM_CLOUD_ARCHITECTURE.md` for the complete 20+ table schema including:
- Products & SKUs with inventory tracking
- Finished goods and assembly tasks
- Worklist task management
- Orders with Shopify integration
- Wiki/documentation system
- Automation rules
- Audit logging and failure tracking

#### Durable Objects Architecture

**HubConnection Durable Object** (one per connected hub):

```typescript
export class HubConnection implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private websocket: WebSocket | null = null;
  private hubId: string | null = null;
  private printerStatuses: Map<string, PrinterStatus> = new Map();
  private pendingCommands: Map<string, CommandCallback> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/command") {
      return this.handleCommand(request);
    }

    if (url.pathname === "/status") {
      return this.handleStatusQuery(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async handleWebSocket(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();

    // Use hibernation API for cost efficiency
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);

    switch (data.type) {
      case "hub_hello":
        await this.handleHubHello(ws, data);
        break;
      case "printer_status":
        await this.handlePrinterStatus(data);
        break;
      case "command_ack":
        await this.handleCommandAck(data);
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.markHubOffline();
  }

  private async handlePrinterStatus(status: PrinterStatus) {
    this.printerStatuses.set(status.printer_id, status);

    // Persist to database
    await this.env.DB.prepare(
      `UPDATE printers SET status = ?, last_status_update = ? WHERE serial_number = ?`
    ).bind(status.status.state, Date.now(), status.printer_id).run();

    // Broadcast to connected dashboard users
    const dashboardDO = this.env.DASHBOARD_BROADCASTS.get(
      this.env.DASHBOARD_BROADCASTS.idFromName(this.tenantId!)
    );
    await dashboardDO.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({
        type: "printer_status",
        data: status
      })
    }));

    // Check automation rules
    await this.checkAutomationRules(status);
  }

  async sendCommand(command: HubCommand): Promise<CommandResult> {
    const ws = this.state.getWebSockets()[0];
    if (!ws) {
      throw new Error("Hub not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(command.command_id);
        reject(new Error("Command timeout"));
      }, 30000);

      this.pendingCommands.set(command.command_id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject
      });

      ws.send(JSON.stringify(command));
    });
  }
}
```

**DashboardBroadcast Durable Object** (one per tenant for dashboard broadcasts):

```typescript
export class DashboardBroadcast implements DurableObject {
  private state: DurableObjectState;
  private sessions: Map<string, WebSocket> = new Map();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      return this.handleDashboardConnect(request);
    }

    if (url.pathname === "/broadcast") {
      return this.handleBroadcast(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async handleDashboardConnect(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    const sessionId = crypto.randomUUID();

    this.state.acceptWebSocket(server, [sessionId]);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "X-Session-Id": sessionId }
    });
  }

  async handleBroadcast(request: Request): Promise<Response> {
    const message = await request.json();

    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(JSON.stringify(message));
      } catch (e) {
        // Socket closed, will be cleaned up
      }
    }

    return new Response("OK");
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    // Cleanup handled automatically by Durable Objects
  }
}
```

#### API Routes (Workers)

```typescript
// src/api/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('/api/*', jwt({ secret: env => env.JWT_SECRET }));

// Authentication
app.post('/auth/register', authController.register);
app.post('/auth/login', authController.login);
app.post('/auth/logout', authController.logout);
app.post('/auth/refresh', authController.refresh);
app.post('/auth/forgot-password', authController.forgotPassword);
app.post('/auth/reset-password', authController.resetPassword);

// Organizations
app.get('/api/organizations', organizationController.list);
app.post('/api/organizations', organizationController.create);
app.get('/api/organizations/:id', organizationController.get);
app.put('/api/organizations/:id', organizationController.update);
app.delete('/api/organizations/:id', organizationController.delete);
app.post('/api/organizations/:id/invite', organizationController.inviteMember);

// Hubs
app.get('/api/hubs', hubController.list);
app.post('/api/hubs/claim', hubController.claim);  // Claim a new hub
app.get('/api/hubs/:id', hubController.get);
app.put('/api/hubs/:id', hubController.update);
app.delete('/api/hubs/:id', hubController.unclaim);
app.post('/api/hubs/:id/reboot', hubController.reboot);

// Printers
app.get('/api/printers', printerController.list);
app.post('/api/printers', printerController.add);
app.get('/api/printers/:id', printerController.get);
app.put('/api/printers/:id', printerController.update);
app.delete('/api/printers/:id', printerController.remove);
app.post('/api/printers/:id/command', printerController.command);
app.get('/api/printers/:id/status', printerController.status);
app.post('/api/printers/discover', printerController.discover);

// Print Jobs
app.get('/api/jobs', jobController.list);
app.post('/api/jobs', jobController.create);
app.get('/api/jobs/:id', jobController.get);
app.post('/api/jobs/:id/start', jobController.start);
app.post('/api/jobs/:id/pause', jobController.pause);
app.post('/api/jobs/:id/resume', jobController.resume);
app.post('/api/jobs/:id/cancel', jobController.cancel);

// Print Queue
app.get('/api/queue', queueController.list);
app.post('/api/queue/reorder', queueController.reorder);
app.post('/api/queue/assign', queueController.assignPrinter);

// Print Files
app.get('/api/files', fileController.list);
app.post('/api/files/upload', fileController.upload);
app.get('/api/files/:id', fileController.get);
app.get('/api/files/:id/download', fileController.download);
app.delete('/api/files/:id', fileController.delete);

// Products
app.get('/api/products', productController.list);
app.post('/api/products', productController.create);
app.get('/api/products/:id', productController.get);
app.put('/api/products/:id', productController.update);
app.delete('/api/products/:id', productController.delete);

// Product Variants
app.get('/api/products/:id/variants', variantController.list);
app.post('/api/products/:id/variants', variantController.create);
app.put('/api/variants/:id', variantController.update);
app.delete('/api/variants/:id', variantController.delete);
app.post('/api/variants/:id/file', variantController.assignFile);

// Inventory
app.get('/api/inventory', inventoryController.list);
app.post('/api/inventory/adjust', inventoryController.adjust);
app.get('/api/inventory/report', inventoryController.report);

// Orders
app.get('/api/orders', orderController.list);
app.post('/api/orders', orderController.create);
app.get('/api/orders/:id', orderController.get);
app.put('/api/orders/:id', orderController.update);
app.post('/api/orders/:id/fulfill', orderController.fulfill);

// Automation
app.get('/api/automation', automationController.list);
app.post('/api/automation', automationController.create);
app.put('/api/automation/:id', automationController.update);
app.delete('/api/automation/:id', automationController.delete);
app.post('/api/automation/:id/test', automationController.test);

// Integrations
app.get('/api/integrations', integrationController.list);
app.post('/api/integrations/shopify', integrationController.connectShopify);
app.delete('/api/integrations/:id', integrationController.disconnect);
app.post('/api/integrations/:id/sync', integrationController.sync);

// Analytics
app.get('/api/analytics/overview', analyticsController.overview);
app.get('/api/analytics/printers', analyticsController.printerStats);
app.get('/api/analytics/production', analyticsController.productionStats);
app.get('/api/analytics/export', analyticsController.export);

// WebSocket endpoint for hub connections
app.get('/ws/hub/:hubId', hubWebSocket.handle);

// WebSocket endpoint for user dashboard
app.get('/ws/dashboard', dashboardWebSocket.handle);

export default app;
```

---

### 4. User Interface (Frontend)

#### Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| Components | Shadcn/ui |
| State Management | Zustand |
| Data Fetching | TanStack Query |
| Real-time | Native WebSocket |
| Charts | Recharts |
| Forms | React Hook Form + Zod |

#### Page Structure

```
/                           # Dashboard overview
/printers                   # Printer management
/printers/:id               # Individual printer view
/jobs                       # Print job management
/queue                      # Print queue view
/files                      # File library
/products                   # Product catalog
/products/:id               # Product detail
/inventory                  # Inventory management
/orders                     # Order management
/orders/:id                 # Order detail
/automation                 # Automation rules
/analytics                  # Analytics dashboard
/integrations               # Third-party integrations
/settings                   # Account settings
/settings/organization      # Organization settings
/settings/hubs              # Hub management
/settings/team              # Team management
/settings/billing           # Billing & subscription
```

#### Real-time Updates Architecture

```typescript
// src/hooks/useRealtimeConnection.ts
export function useRealtimeConnection() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`wss://api.printfarm.io/ws/dashboard`);

      ws.onopen = () => {
        setStatus('connected');
        ws.send(JSON.stringify({
          type: 'auth',
          token: getAuthToken()
        }));
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'printer_status':
            // Optimistic update via TanStack Query
            queryClient.setQueryData(
              ['printers', message.data.printer_id],
              (old: Printer) => ({ ...old, status: message.data.status })
            );
            break;

          case 'job_update':
            queryClient.setQueryData(
              ['jobs', message.data.job_id],
              (old: Job) => ({ ...old, ...message.data })
            );
            queryClient.invalidateQueries(['jobs']);
            break;

          case 'hub_status':
            queryClient.setQueryData(
              ['hubs', message.data.hub_id],
              (old: Hub) => ({ ...old, is_online: message.data.is_online })
            );
            break;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { status, ws: wsRef.current };
}
```

---

### 5. Hub Onboarding Flow

#### Step-by-Step User Experience

```
1. UNBOX & POWER ON
   └─ User plugs hub into power
   └─ Hub boots, blue LED blinks (no WiFi configured)
   └─ Hub starts BLE advertising

2. OPEN WEB APP
   └─ User navigates to app.printfarm.io
   └─ User logs in or creates account

3. ADD HUB
   └─ User clicks "Add Hub"
   └─ Browser requests Bluetooth permission
   └─ Browser scans for nearby hubs
   └─ User selects their hub from list

4. BLUETOOTH PAIRING
   └─ Browser connects to hub via BLE
   └─ Hub displays pairing code on LED (if available) or sends to browser
   └─ User confirms pairing

5. WIFI CONFIGURATION
   └─ Browser requests hub's available WiFi networks
   └─ User selects their network
   └─ User enters WiFi password
   └─ Browser sends credentials to hub via BLE

6. CLOUD REGISTRATION
   └─ Hub connects to WiFi
   └─ Hub connects to cloud WebSocket
   └─ Hub sends claim token received via BLE
   └─ Cloud associates hub with user's organization
   └─ Cloud acknowledges registration

7. COMPLETION
   └─ Hub LED turns solid blue (cloud connected)
   └─ Browser shows "Hub Added Successfully"
   └─ User can now add printers to this hub
```

#### Web Bluetooth Implementation

```typescript
// src/services/hubPairing.ts
const HUB_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';
const WIFI_CHAR_UUID = '12345678-1234-5678-1234-56789abcdef1';
const CLAIM_CHAR_UUID = '12345678-1234-5678-1234-56789abcdef2';
const STATUS_CHAR_UUID = '12345678-1234-5678-1234-56789abcdef3';

export class HubPairingService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;

  async scanForHubs(): Promise<BluetoothDevice> {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HUB_SERVICE_UUID] }],
      optionalServices: [HUB_SERVICE_UUID]
    });
    return this.device;
  }

  async connect(): Promise<void> {
    if (!this.device) throw new Error('No device selected');
    this.server = await this.device.gatt!.connect();
  }

  async configureWifi(ssid: string, password: string): Promise<void> {
    const service = await this.server!.getPrimaryService(HUB_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(WIFI_CHAR_UUID);

    const config = JSON.stringify({ ssid, password });
    const encoder = new TextEncoder();
    await characteristic.writeValue(encoder.encode(config));
  }

  async sendClaimToken(token: string): Promise<void> {
    const service = await this.server!.getPrimaryService(HUB_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CLAIM_CHAR_UUID);

    const encoder = new TextEncoder();
    await characteristic.writeValue(encoder.encode(token));
  }

  async getStatus(): Promise<HubStatus> {
    const service = await this.server!.getPrimaryService(HUB_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(STATUS_CHAR_UUID);

    const value = await characteristic.readValue();
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(value));
  }

  async subscribeToStatus(callback: (status: HubStatus) => void): Promise<void> {
    const service = await this.server!.getPrimaryService(HUB_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(STATUS_CHAR_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value!;
      const decoder = new TextDecoder();
      callback(JSON.parse(decoder.decode(value)));
    });
  }

  disconnect(): void {
    this.server?.disconnect();
    this.device = null;
    this.server = null;
  }
}
```

---

### 6. Printer Discovery & Connection

#### Network Discovery Process

The hub discovers Bambu printers on the local network using mDNS/SSDP:

```
1. HUB RECEIVES DISCOVER COMMAND
   └─ Cloud sends { type: "discover_printers" }

2. MDNS QUERY
   └─ Hub sends mDNS query for _bambu._tcp.local
   └─ Bambu printers respond with their info

3. SSDP FALLBACK
   └─ Hub sends SSDP M-SEARCH for Bambu devices
   └─ Collects responses

4. REPORT RESULTS
   └─ Hub sends discovered printers to cloud
   └─ Cloud stores in database for user selection

5. USER SELECTS PRINTER
   └─ User enters printer's access code
   └─ Cloud sends configure_printer command

6. HUB CONNECTS
   └─ Hub establishes MQTT connection to printer
   └─ Hub starts relaying status updates
```

#### Bambu MQTT Connection

```c
// ESP32 firmware - printer_mqtt.c
typedef struct {
    char serial[32];
    char ip_address[16];
    char access_code[16];
    esp_mqtt_client_handle_t client;
    bool connected;
} printer_connection_t;

printer_connection_t printers[MAX_PRINTERS];

void connect_to_printer(int slot, const char* serial, const char* ip, const char* access_code) {
    char client_id[64];
    char username[] = "bblp";
    char topic[64];

    snprintf(client_id, sizeof(client_id), "printfarm_%s", hub_id);
    snprintf(topic, sizeof(topic), "device/%s/report", serial);

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.hostname = ip,
        .broker.address.port = 8883,
        .broker.address.transport = MQTT_TRANSPORT_OVER_SSL,
        .credentials.username = username,
        .credentials.authentication.password = access_code,
        .credentials.client_id = client_id,
        .session.disable_clean_session = false,
    };

    printers[slot].client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(printers[slot].client, ESP_EVENT_ANY_ID, mqtt_event_handler, &printers[slot]);
    esp_mqtt_client_start(printers[slot].client);

    // Subscribe to printer reports
    esp_mqtt_client_subscribe(printers[slot].client, topic, 0);
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data) {
    printer_connection_t *printer = (printer_connection_t *)handler_args;
    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            printer->connected = true;
            send_printer_status_to_cloud(printer->serial, "connected");
            break;

        case MQTT_EVENT_DISCONNECTED:
            printer->connected = false;
            send_printer_status_to_cloud(printer->serial, "disconnected");
            break;

        case MQTT_EVENT_DATA:
            // Parse Bambu status message and relay to cloud
            handle_printer_message(printer->serial, event->data, event->data_len);
            break;
    }
}
```

---

### 7. Print Job Workflow

#### Complete Print Job Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRINT JOB LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐   │
│   │ QUEUED │───►│ASSIGNED│───►│SENDING │───►│PRINTING│───►│COMPLETE│   │
│   └────────┘    └────────┘    └────────┘    └────────┘    └────────┘   │
│        │             │             │             │                       │
│        │             │             │             ▼                       │
│        │             │             │        ┌────────┐                   │
│        │             │             │        │ PAUSED │                   │
│        │             │             │        └────────┘                   │
│        │             │             │             │                       │
│        ▼             ▼             ▼             ▼                       │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                     CANCELLED / FAILED                           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Job Execution Sequence

```
1. USER CREATES JOB
   ├─ Selects print file
   ├─ Optionally assigns to specific printer
   ├─ Sets priority
   └─ Job status: QUEUED

2. AUTO-ASSIGNMENT (if not manually assigned)
   ├─ Cloud checks for idle compatible printers
   ├─ Considers: filament match, plate type, nozzle size
   ├─ Assigns to best available printer
   └─ Job status: ASSIGNED

3. JOB START
   ├─ User clicks "Start" or automation triggers
   ├─ Cloud generates presigned R2 URL for file
   ├─ Cloud sends print_command to hub DO
   └─ Job status: SENDING

4. FILE TRANSFER
   ├─ Hub downloads file from R2 URL
   ├─ Hub sends file to printer via MQTT
   ├─ Hub reports transfer progress
   └─ Transfer complete

5. PRINT START
   ├─ Hub sends start command to printer
   ├─ Printer begins printing
   ├─ Hub starts relaying status updates
   └─ Job status: PRINTING

6. DURING PRINT
   ├─ Hub sends status updates every 5 seconds
   ├─ Cloud updates job progress
   ├─ Dashboard shows real-time progress
   └─ User can pause/cancel

7. PRINT COMPLETE
   ├─ Printer reports completion
   ├─ Hub relays to cloud
   ├─ Cloud updates job status
   ├─ Automation rules triggered
   └─ Job status: COMPLETE

8. POST-PRINT AUTOMATION
   ├─ Increment inventory (if configured)
   ├─ Update order fulfillment
   ├─ Send notification
   └─ Start next queued job
```

#### Print Command Flow (Technical)

```typescript
// Cloud Worker - jobController.ts
async function startJob(jobId: string, env: Env): Promise<void> {
  // Get job details
  const job = await env.DB.prepare(
    `SELECT j.*, p.hub_id, p.serial_number, f.file_key
     FROM print_jobs j
     JOIN printers p ON j.printer_id = p.id
     JOIN print_files f ON j.print_file_id = f.id
     WHERE j.id = ?`
  ).bind(jobId).first();

  if (!job) throw new Error('Job not found');
  if (job.status !== 'assigned') throw new Error('Job not ready to start');

  // Generate presigned URL for file download
  const fileUrl = await env.R2.createPresignedUrl(job.file_key, {
    expiresIn: 3600
  });

  // Get hub Durable Object
  const hubDO = env.HUB_CONNECTIONS.get(
    env.HUB_CONNECTIONS.idFromName(job.hub_id)
  );

  // Send print command
  const result = await hubDO.fetch(new Request('http://internal/command', {
    method: 'POST',
    body: JSON.stringify({
      type: 'print_command',
      command_id: crypto.randomUUID(),
      printer_id: job.serial_number,
      action: 'start',
      file_url: fileUrl,
      file_name: job.file_key.split('/').pop()
    })
  }));

  if (!result.ok) {
    throw new Error('Failed to send print command');
  }

  // Update job status
  await env.DB.prepare(
    `UPDATE print_jobs SET status = 'sending', started_at = ? WHERE id = ?`
  ).bind(Date.now(), jobId).run();
}
```

---

### 8. Automation System

#### Automation Rule Structure

```typescript
interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  is_active: boolean;
}

type AutomationTrigger =
  | { type: 'print_complete'; printer_id?: string }
  | { type: 'print_failed'; printer_id?: string }
  | { type: 'printer_idle'; printer_id?: string; idle_minutes: number }
  | { type: 'order_received'; source?: string }
  | { type: 'inventory_low'; product_id?: string }
  | { type: 'schedule'; cron: string };

interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
  value: any;
}

type AutomationAction =
  | { type: 'start_next_job' }
  | { type: 'increment_inventory'; product_variant_id: string; quantity: number }
  | { type: 'send_notification'; channel: 'email' | 'webhook' | 'slack'; message: string }
  | { type: 'create_job'; print_file_id: string; printer_id?: string }
  | { type: 'update_order_status'; status: string }
  | { type: 'call_webhook'; url: string; payload: object };
```

#### Example Automation Rules

```json
// Auto-start next job when print completes
{
  "name": "Auto-queue next print",
  "trigger": { "type": "print_complete" },
  "conditions": [],
  "actions": [
    { "type": "start_next_job" }
  ]
}

// Track inventory on completion
{
  "name": "Update inventory on completion",
  "trigger": { "type": "print_complete" },
  "conditions": [
    { "field": "job.product_variant_id", "operator": "not_equals", "value": null }
  ],
  "actions": [
    {
      "type": "increment_inventory",
      "product_variant_id": "{{job.product_variant_id}}",
      "quantity": 1
    }
  ]
}

// Alert on failure
{
  "name": "Alert on print failure",
  "trigger": { "type": "print_failed" },
  "conditions": [],
  "actions": [
    {
      "type": "send_notification",
      "channel": "email",
      "message": "Print failed on {{printer.name}}: {{job.error_message}}"
    }
  ]
}

// Auto-fulfill orders
{
  "name": "Auto-create jobs for orders",
  "trigger": { "type": "order_received" },
  "conditions": [],
  "actions": [
    {
      "type": "call_webhook",
      "url": "https://api.printfarm.io/internal/process-order",
      "payload": { "order_id": "{{order.id}}" }
    }
  ]
}
```

#### Automation Execution Engine

```typescript
// src/services/automationEngine.ts
export class AutomationEngine {
  constructor(private env: Env) {}

  async handleEvent(event: AutomationEvent): Promise<void> {
    // Get matching rules
    const rules = await this.env.DB.prepare(
      `SELECT * FROM automation_rules
       WHERE organization_id = ?
       AND is_active = 1
       AND trigger_type = ?`
    ).bind(event.organization_id, event.type).all();

    for (const rule of rules.results) {
      try {
        const ruleConfig = {
          ...rule,
          trigger: JSON.parse(rule.trigger),
          conditions: JSON.parse(rule.conditions || '[]'),
          actions: JSON.parse(rule.actions)
        };

        // Check conditions
        if (!this.evaluateConditions(ruleConfig.conditions, event.context)) {
          continue;
        }

        // Execute actions
        for (const action of ruleConfig.actions) {
          await this.executeAction(action, event.context);
        }

        // Log execution
        await this.logExecution(rule.id, event, 'success');
      } catch (error) {
        await this.logExecution(rule.id, event, 'error', error.message);
      }
    }
  }

  private evaluateConditions(conditions: AutomationCondition[], context: any): boolean {
    for (const condition of conditions) {
      const value = this.getNestedValue(context, condition.field);

      switch (condition.operator) {
        case 'equals':
          if (value !== condition.value) return false;
          break;
        case 'not_equals':
          if (value === condition.value) return false;
          break;
        case 'greater_than':
          if (value <= condition.value) return false;
          break;
        case 'less_than':
          if (value >= condition.value) return false;
          break;
        case 'contains':
          if (!value?.includes(condition.value)) return false;
          break;
      }
    }
    return true;
  }

  private async executeAction(action: AutomationAction, context: any): Promise<void> {
    switch (action.type) {
      case 'start_next_job':
        await this.startNextJob(context.printer_id);
        break;

      case 'increment_inventory':
        await this.incrementInventory(
          this.interpolate(action.product_variant_id, context),
          action.quantity
        );
        break;

      case 'send_notification':
        await this.sendNotification(
          action.channel,
          this.interpolate(action.message, context),
          context
        );
        break;

      case 'call_webhook':
        await this.callWebhook(
          action.url,
          this.interpolateObject(action.payload, context)
        );
        break;
    }
  }

  private interpolate(template: string, context: any): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      return this.getNestedValue(context, path.trim()) ?? '';
    });
  }
}
```

---

### 9. Security Architecture

#### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   User Login                                                         │
│   ─────────                                                          │
│   1. User submits email/password                                     │
│   2. Worker validates credentials against D1                         │
│   3. Worker generates JWT (access + refresh tokens)                  │
│   4. Tokens stored in httpOnly cookies                               │
│   5. Access token: 15 min expiry, Refresh token: 7 day expiry        │
│                                                                      │
│   API Authentication                                                 │
│   ──────────────────                                                 │
│   1. All /api/* routes require valid JWT                             │
│   2. JWT validated at edge by Worker middleware                      │
│   3. User/org context extracted from token                           │
│   4. Rate limiting per user/IP                                       │
│                                                                      │
│   Hub Authentication                                                 │
│   ──────────────────                                                 │
│   1. Hub has factory-provisioned unique ID + secret                  │
│   2. Hub connects to /ws/hub/{hubId}                                 │
│   3. Hub sends hub_hello with HMAC signature                         │
│   4. Durable Object validates signature against stored secret        │
│   5. Connection accepted only if hub is claimed by an org            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Data Security

| Data Type | Protection |
|-----------|------------|
| User passwords | Argon2id hashing |
| Printer access codes | AES-256-GCM encryption at rest |
| API tokens | JWT with RS256 signing |
| Hub secrets | HMAC-SHA256 |
| Data in transit | TLS 1.3 everywhere |
| Database | D1 encryption at rest |
| File storage | R2 encryption at rest |

#### Multi-Tenancy Isolation

```typescript
// Every database query is scoped to organization
async function getPrinters(env: Env, orgId: string): Promise<Printer[]> {
  return await env.DB.prepare(
    `SELECT p.* FROM printers p
     JOIN hubs h ON p.hub_id = h.id
     WHERE h.organization_id = ?`
  ).bind(orgId).all();
}

// Durable Objects are namespaced by hub ID
// Only the owning organization can send commands
async function sendCommand(env: Env, hubId: string, orgId: string, command: any) {
  // Verify ownership
  const hub = await env.DB.prepare(
    `SELECT * FROM hubs WHERE id = ? AND organization_id = ?`
  ).bind(hubId, orgId).first();

  if (!hub) throw new Error('Hub not found or access denied');

  // Send command
  const hubDO = env.HUB_CONNECTIONS.get(env.HUB_CONNECTIONS.idFromName(hubId));
  return hubDO.fetch(new Request('http://internal/command', {
    method: 'POST',
    body: JSON.stringify(command)
  }));
}
```

---

### 10. Deployment & Operations

#### Infrastructure Setup

```bash
# Cloudflare setup
wrangler init printfarm-api
wrangler d1 create printfarm-db
wrangler r2 bucket create printfarm-files
wrangler kv:namespace create CACHE

# Deploy
wrangler deploy

# Database migrations
wrangler d1 migrations apply printfarm-db

# Frontend
cd frontend && npm run build
wrangler pages deploy dist
```

#### Monitoring & Observability

```typescript
// Analytics Engine for metrics
async function trackMetric(env: Env, metric: Metric) {
  await env.ANALYTICS.writeDataPoint({
    blobs: [metric.name, metric.organization_id],
    doubles: [metric.value],
    indexes: [metric.type]
  });
}

// Error tracking
async function logError(env: Env, error: Error, context: any) {
  await env.ANALYTICS.writeDataPoint({
    blobs: ['error', error.message, JSON.stringify(context)],
    indexes: ['error']
  });
}
```

#### Cost Estimation

| Service | Usage (100 hubs, 500 printers) | Monthly Cost |
|---------|--------------------------------|--------------|
| Workers | 10M requests | $5 |
| Durable Objects | 500 objects, 100GB-hours | $15 |
| D1 | 5GB storage, 25M reads | $5 |
| R2 | 100GB storage, 10M operations | $5 |
| Pages | Unlimited | Free |
| KV | 10GB, 25M reads | $5 |
| **Total** | | **~$35/month** |

---

### 11. Scaling Considerations

#### Horizontal Scaling

- **Workers**: Automatically scale to handle request load
- **Durable Objects**: One per hub provides natural sharding
- **D1**: Read replicas for geo-distribution
- **R2**: Global edge caching for files

#### Limits & Quotas

| Resource | Limit | Mitigation |
|----------|-------|------------|
| WebSocket connections per DO | 32,000 | One DO per hub (max 5 printers) |
| D1 database size | 10GB | Partition by organization if needed |
| Worker CPU time | 30s | Offload heavy work to queues |
| R2 object size | 5TB | More than enough for G-code files |

#### Future Scaling Path

1. **Phase 1** (0-1000 hubs): Single D1 database, single Worker
2. **Phase 2** (1000-10,000 hubs): Read replicas, regional Workers
3. **Phase 3** (10,000+ hubs): Database sharding by organization

---

## Appendix A: ESP32 Firmware Build

```yaml
# platformio.ini
[env:esp32s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = espidf
monitor_speed = 115200

build_flags =
    -DCONFIG_ESP_TLS_USING_MBEDTLS=y
    -DCONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y

lib_deps =
    espressif/esp_websocket_client @ ^1.0.0
    espressif/esp-mqtt @ ^1.3.0
    espressif/mdns @ ^1.2.0
```

## Appendix B: Cloudflare Worker Configuration

```toml
# wrangler.toml
name = "printfarm-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "HUB_CONNECTIONS"
class_name = "HubConnection"

[[durable_objects.bindings]]
name = "USER_SESSIONS"
class_name = "UserSession"

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["HubConnection", "UserSession"]

[[d1_databases]]
binding = "DB"
database_name = "printfarm-db"
database_id = "xxxxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "printfarm-files"

[[kv_namespaces]]
binding = "CACHE"
id = "xxxxx"

[vars]
ENVIRONMENT = "production"
```

## Appendix C: Mobile App Considerations

For mobile pairing (iOS/Android), Web Bluetooth is not available. Options:

1. **React Native with BLE library**: Full native app with BLE support
2. **Capacitor/Ionic**: Web app with BLE plugin
3. **Native SDK**: Provide native SDKs for third-party integrations

Recommended: Start with web-only (desktop Chrome/Edge), add mobile apps later.

---

*Document Version: 1.0*
*Last Updated: 2024*
