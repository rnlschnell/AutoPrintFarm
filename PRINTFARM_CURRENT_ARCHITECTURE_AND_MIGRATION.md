# PrintFarmSoftware: Current Architecture & Migration Guide

## Executive Summary

This document details the complete architecture of the current PrintFarmSoftware system running on Raspberry Pi and maps each component to its equivalent in the new ESP32 + Cloudflare cloud architecture.

---

## Table of Contents

1. [Current System Overview](#current-system-overview)
2. [Backend Architecture](#backend-architecture)
3. [Frontend Architecture](#frontend-architecture)
4. [Database Schema](#database-schema)
5. [Printer Communication](#printer-communication)
6. [Services & Background Tasks](#services--background-tasks)
7. [API Endpoints](#api-endpoints)
8. [Migration Mapping](#migration-mapping)
9. [Data Migration Strategy](#data-migration-strategy)

---

## Current System Overview

### Deployment Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────┘

  User Browser                    Raspberry Pi (192.168.4.45:8080)
       │                                      │
       │  HTTP/WebSocket                      │
       └──────────────────────────────────────┤
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                    │
                    │  FastAPI Application (Python 3.11)                │
                    │  ├── REST API Endpoints (/api/*)                  │
                    │  ├── WebSocket Server (/api/v1/ws)                │
                    │  ├── Static File Server (React build)             │
                    │  └── Background Services                          │
                    │                                                    │
                    ├────────────────────────────────────────────────────┤
                    │                                                    │
                    │  SQLite Database (data/tenant.db)                 │
                    │  ├── Printers, Products, SKUs                     │
                    │  ├── Print Jobs, Print Files                      │
                    │  ├── Color Presets, Build Plates                  │
                    │  └── Worklist, Assembly Tasks                     │
                    │                                                    │
                    ├────────────────────────────────────────────────────┤
                    │                                                    │
                    │  File Storage (files/)                            │
                    │  ├── 3MF Print Files                              │
                    │  └── Product Images                               │
                    │                                                    │
                    └─────────────────────────────────────────────────────┘
                                              │
                                              │ MQTT (LAN)
                                              ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  Bambu Lab Printers (Local Network)                 │
                    │  ├── MQTT on port 8883 (TLS)                       │
                    │  ├── Device reports via device/{serial}/report     │
                    │  └── Commands via device/{serial}/request          │
                    └─────────────────────────────────────────────────────┘
                                              │
                                              │ HTTPS (Internet)
                                              ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  External Services                                  │
                    │  ├── Supabase (Auth + Cloud Backup)                │
                    │  └── Shopify (Order Sync)                          │
                    └─────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Current Technology | Location |
|-------|-------------------|----------|
| **Frontend** | React 18.3 + TypeScript + Vite + shadcn/ui | Pi: `/frontend/dist/` |
| **Backend** | Python 3.11 + FastAPI + Uvicorn | Pi: `/src/` |
| **Database** | SQLite + SQLAlchemy (async) | Pi: `/data/tenant.db` |
| **Auth** | Supabase Auth + JWT | Cloud (Supabase) |
| **Real-time** | WebSocket (native FastAPI) | Pi |
| **Printer Comms** | bambulabs_api (MQTT) | Pi → Printers (LAN) |
| **File Storage** | Local filesystem | Pi: `/files/` |
| **Cloud Backup** | Supabase PostgreSQL | Cloud (Supabase) |

---

## Backend Architecture

### Entry Point: `src/main.py`

The application starts with FastAPI and manages the complete lifecycle:

```python
# Key initialization sequence:
1. ConfigService → Load tenant_config.yaml
2. AuthService → Initialize Supabase connection
3. DatabaseService → Initialize SQLite + run migrations
4. StartupService → Job queue + resource monitoring
5. SyncService → Supabase real-time sync
6. ShopifySyncService → Order polling
7. TunnelService → Cloudflare tunnel (if configured)
8. PrinterConnectionService → Connect to all printers
9. LiveJobSyncService → Monitor active print jobs
10. PrintJobSyncService → Sync job status changes
```

### Service Layer (`src/services/`)

| Service | File | Purpose | Migration Target |
|---------|------|---------|------------------|
| **AuthService** | `auth_service.py` | Supabase JWT auth, session management | Cloudflare Workers + D1 |
| **ConfigService** | `config_service.py` | YAML config loading, env vars | Workers env bindings |
| **DatabaseService** | `database_service.py` | SQLite CRUD, all table operations | D1 Database |
| **PrinterConnectionService** | `printer_connection_service.py` | Manage printer MQTT connections | ESP32 Hub firmware |
| **LiveJobSyncService** | `live_job_sync_service.py` | Real-time job progress tracking | Durable Object state |
| **PrintJobSyncService** | `print_job_sync_service.py` | Job status change detection | Durable Object + D1 |
| **SyncService** | `sync_service.py` | Supabase ↔ SQLite bidirectional sync | Eliminated (D1 is source of truth) |
| **ShopifySyncService** | `shopify_order_sync_service.py` | Poll Shopify for new orders | Workers scheduled trigger |
| **TunnelService** | `tunnel_service.py` | Cloudflare tunnel for remote access | Eliminated (native cloud) |
| **StartupService** | `startup_service.py` | Job queue, resource monitoring | Workers + Queues |

### Core Components (`src/core/`)

| Component | File | Purpose | Migration Target |
|-----------|------|---------|------------------|
| **PrinterClientManager** | `printer_client.py` | Bambu MQTT client wrapper | ESP32 firmware |
| **ConnectionManager** | `connection_manager.py` | Rate limiting, circuit breaker | ESP32 + Durable Object |
| **ResourceMonitor** | (in utils) | System health monitoring | Workers analytics |

---

## Frontend Architecture

### Pages (`frontend/src/pages/`)

| Page | File | Purpose |
|------|------|---------|
| **Dashboard** | `Index.tsx` | Printer grid, live status, quick actions |
| **Printers** | `Printers.tsx` | Printer management, add/edit/delete |
| **Worklist** | `Worklist.tsx` | Task management, priorities |
| **PrintQueue** | `PrintQueue.tsx` | Job queue, drag-drop reorder |
| **Products** | `Products.tsx` | Product catalog management |
| **Inventory** | `Inventory.tsx` | Stock levels, SKU management |
| **Orders** | `Orders.tsx` | Shopify order integration |
| **Settings** | `Settings.tsx` | System configuration |
| **Analytics** | `Analytics.tsx` | Print statistics, reports |

### Key Components (`frontend/src/components/`)

```
components/
├── Layout.tsx              # Main app layout with sidebar
├── Header.tsx              # Top navigation bar
├── ErrorBoundary.tsx       # React error handling
├── ThemeProvider.tsx       # Dark/light mode
├── auth/
│   ├── SimpleAuthPage.tsx  # Login/signup form
│   └── SimpleProtectedRoute.tsx  # Route guard
├── printers/
│   ├── PrinterCard.tsx     # Individual printer display
│   ├── PrinterGrid.tsx     # Grid of printer cards
│   └── PrinterDetails.tsx  # Printer modal/sidebar
├── ui/                     # shadcn/ui components
└── ...
```

### State Management

| Library | Purpose |
|---------|---------|
| **TanStack Query** | Server state, caching, refetching |
| **React Context** | Auth state, color presets, theme |
| **Local State** | Component-level UI state |

### API Communication (`frontend/src/services/`)

All API calls go through fetch to `/api/*` endpoints:
- REST for CRUD operations
- WebSocket for real-time printer status

---

## Database Schema

### Tables in SQLite (`data/tenant.db`)

#### Core Tables

```sql
-- Printers: Physical printer configuration
printers (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    printer_id INTEGER,           -- Simple numeric ID
    name TEXT NOT NULL,
    model TEXT NOT NULL,          -- "A1", "A1 Mini", "P1S", etc.
    ip_address TEXT,
    serial_number TEXT,
    access_code TEXT,
    is_connected BOOLEAN,
    status TEXT,                  -- "idle", "printing", "maintenance", "offline"
    current_color TEXT,
    current_filament_type TEXT,
    cleared BOOLEAN,              -- Bed cleared after print
    sort_order INTEGER,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
)

-- Products: Catalog items
products (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    print_file_id UUID,
    requires_assembly BOOLEAN,
    requires_post_processing BOOLEAN,
    image_url TEXT,
    is_active BOOLEAN
)

-- Product SKUs: Color/filament variants
product_skus (
    id UUID PRIMARY KEY,
    product_id UUID REFERENCES products(id),
    tenant_id UUID NOT NULL,
    sku TEXT NOT NULL,
    color TEXT NOT NULL,
    filament_type TEXT,
    hex_code TEXT,
    stock_level INTEGER,
    low_stock_threshold INTEGER,
    is_active BOOLEAN
)

-- Print Files: 3MF file metadata
print_files (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    product_id UUID REFERENCES products(id),
    name TEXT NOT NULL,
    local_file_path TEXT,
    print_time_seconds INTEGER,
    filament_weight_grams FLOAT,
    filament_type TEXT,
    printer_model_id TEXT,        -- "N1", "N2S", "P1P", etc.
    nozzle_diameter FLOAT,
    layer_count INTEGER,
    object_count INTEGER
)

-- Print Jobs: Queue and history
print_jobs (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    printer_id UUID REFERENCES printers(id),
    print_file_id UUID REFERENCES print_files(id),
    product_sku_id UUID REFERENCES product_skus(id),
    status TEXT,                  -- "queued", "printing", "completed", "failed", "cancelled"
    color TEXT,
    filament_type TEXT,
    progress_percentage INTEGER,
    bambu_job_id TEXT,           -- Printer's internal job ID
    priority INTEGER,
    time_submitted DATETIME,
    time_started DATETIME,
    time_completed DATETIME
)
```

#### Supporting Tables

```sql
-- Color Presets: Filament colors
color_presets (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    color_name TEXT NOT NULL,
    hex_code TEXT NOT NULL,
    filament_type TEXT NOT NULL,
    is_active BOOLEAN
)

-- Build Plate Types
build_plate_types (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN
)

-- Finished Goods: Completed inventory
finished_goods (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    product_sku_id UUID REFERENCES product_skus(id),
    quantity INTEGER,
    location TEXT
)

-- Assembly Tasks
assembly_tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    product_id UUID REFERENCES products(id),
    status TEXT,
    assigned_to TEXT,
    priority INTEGER
)

-- Worklist Tasks
worklist_tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT,
    priority INTEGER,
    due_date DATE
)

-- Sync Logs: Debug/audit trail
sync_logs (
    id INTEGER PRIMARY KEY,
    operation_type TEXT,
    table_name TEXT,
    record_id TEXT,
    status TEXT,
    error_message TEXT,
    created_at DATETIME
)
```

---

## Printer Communication

### Bambu MQTT Protocol

The system uses the `bambulabs_api` Python library to communicate with Bambu Lab printers over MQTT.

#### Connection Flow

```
1. TCP connection to printer IP:8883 (TLS)
2. MQTT authentication with access_code
3. Subscribe to: device/{serial}/report
4. Publish to: device/{serial}/request
```

#### Key Message Types

```python
# Printer Status (received)
{
    "print": {
        "gcode_state": "RUNNING",      # IDLE, RUNNING, PAUSE, FINISH, FAILED
        "mc_percent": 45,              # Progress percentage
        "mc_remaining_time": 3600,     # Seconds remaining
        "layer_num": 50,
        "total_layer_num": 200,
        "subtask_name": "model.3mf",
        "job_id": "12345"
    },
    "system": {
        "wifi_signal": -45,
        "led_mode": "on"
    }
}

# Commands (sent)
{
    "print": {
        "command": "project_file",
        "param": "/sdcard/model.3mf",
        "subtask_name": "model.3mf"
    }
}

# Or simpler commands:
{
    "print": {
        "command": "pause"  # pause, resume, stop
    }
}
```

#### PrinterClientManager (`src/core/printer_client.py`)

```python
class PrinterClientManager:
    clients: Dict[str, bl.Printer]           # Active MQTT connections
    printer_configs: Dict[str, Dict]         # Stored configurations
    sequence_ids: Dict[str, int]             # MQTT sequence tracking
    reconnect_tasks: Dict[str, asyncio.Task] # Auto-reconnect tasks

    # Key methods:
    async def connect_printer(printer_id: str)
    def disconnect_printer(printer_id: str)
    def get_printer_status(printer_id: str) -> Dict
    async def send_print_job(printer_id: str, file_path: str)
    async def control_print(printer_id: str, action: str)  # pause/resume/stop
```

---

## Services & Background Tasks

### LiveJobSyncService

Monitors all active print jobs and updates the database with real-time progress:

```python
class LiveJobSyncService:
    async def start():
        # Runs every 5 seconds
        while running:
            for printer in connected_printers:
                status = get_printer_status(printer)
                if status.gcode_state == "RUNNING":
                    update_job_progress(status)
                elif status.gcode_state == "FINISH":
                    mark_job_completed(status)
                    update_inventory(status)
            await asyncio.sleep(5)
```

### PrinterConnectionService

Database-driven printer connection management:

```python
class PrinterConnectionService:
    async def sync_printers_from_database():
        # Get all active printers from SQLite
        printers = db.get_printers_by_tenant(tenant_id)

        # Connect to each printer
        for printer in printers:
            if printer.is_active:
                await printer_manager.connect_printer(printer.printer_id)

    async def handle_printer_update(event):
        # React to database changes (add/remove/update printer)
        if event.type == "INSERT":
            connect_new_printer(event.data)
        elif event.type == "DELETE":
            disconnect_printer(event.data.id)
```

### ShopifySyncService

Polls Shopify for new orders:

```python
class ShopifySyncService:
    poll_interval = 60  # seconds

    async def poll_orders():
        orders = await shopify_api.get_unfulfilled_orders()
        for order in orders:
            if not exists_in_db(order):
                create_worklist_tasks(order)
                create_print_jobs(order)
```

---

## API Endpoints

### Printers API (`/api/printers/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List all printers |
| GET | `/{id}` | Get printer details |
| POST | `/` | Add new printer |
| PUT | `/{id}` | Update printer |
| DELETE | `/{id}` | Remove printer |
| POST | `/{id}/connect` | Connect to printer |
| POST | `/{id}/disconnect` | Disconnect from printer |
| GET | `/{id}/status` | Get real-time status |

### Print Jobs API (`/api/print-jobs/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List print jobs (with filters) |
| GET | `/{id}` | Get job details |
| POST | `/` | Create new print job |
| PUT | `/{id}` | Update job |
| DELETE | `/{id}` | Cancel/delete job |
| POST | `/{id}/start` | Send to printer |
| POST | `/{id}/pause` | Pause job |
| POST | `/{id}/resume` | Resume job |
| POST | `/{id}/cancel` | Cancel job |

### Products API (`/api/products/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List products |
| GET | `/{id}` | Get product with SKUs |
| POST | `/` | Create product |
| PUT | `/{id}` | Update product |
| DELETE | `/{id}` | Delete product |

### Files API (`/api/files/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List print files |
| POST | `/upload` | Upload 3MF file |
| GET | `/{id}/download` | Download file |
| DELETE | `/{id}` | Delete file |

### WebSocket API (`/api/v1/ws`)

```javascript
// Client connection
ws = new WebSocket("ws://192.168.4.45:8080/api/v1/ws");

// Received messages
{
    "type": "printer_status",
    "printer_id": "4",
    "data": {
        "status": "printing",
        "progress": 45,
        "remaining_time": 3600
    }
}

// Send commands
{
    "type": "subscribe",
    "printers": ["4", "7", "8"]
}
```

---

## Migration Mapping

### Component-by-Component Migration

| Current Component | Current Location | New Component | New Location |
|-------------------|------------------|---------------|--------------|
| **FastAPI Backend** | Pi: `src/` | Workers API | Cloudflare Workers |
| **React Frontend** | Pi: `frontend/dist/` | Static Site | Cloudflare Pages |
| **SQLite Database** | Pi: `data/tenant.db` | D1 Database | Cloudflare D1 |
| **File Storage** | Pi: `files/` | R2 Bucket | Cloudflare R2 |
| **Supabase Auth** | Cloud | Workers Auth | Cloudflare Workers |
| **WebSocket Server** | Pi: FastAPI | Durable Objects | Cloudflare DO |
| **Printer MQTT** | Pi: `printer_client.py` | ESP32 Firmware | ESP32 Hub |
| **Background Jobs** | Pi: asyncio tasks | Cron Triggers | Workers Cron |
| **Supabase Sync** | Pi: `sync_service.py` | Eliminated | N/A (D1 is truth) |
| **Tunnel Service** | Pi: cloudflared | Native Cloud | N/A |

### Service Migration Details

#### AuthService → Workers + D1

```typescript
// Current (Python)
class AuthService:
    supabase = create_client(url, key)
    async def login(email, password):
        return supabase.auth.sign_in(email=email, password=password)

// New (Workers)
export async function login(request: Request, env: Env): Promise<Response> {
    const { email, password } = await request.json();
    const user = await env.DB.prepare(
        "SELECT * FROM users WHERE email = ?"
    ).bind(email).first();

    if (user && await verifyPassword(password, user.password_hash)) {
        const token = await createJWT(user, env.JWT_SECRET);
        return new Response(JSON.stringify({ token, user }));
    }
    return new Response("Unauthorized", { status: 401 });
}
```

#### DatabaseService → D1

```typescript
// Current (Python + SQLAlchemy)
async def get_printers_by_tenant(tenant_id: str) -> List[Printer]:
    async with session() as db:
        result = await db.execute(
            text("SELECT * FROM printers WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id}
        )
        return result.fetchall()

// New (Workers + D1)
export async function getPrintersByTenant(tenantId: string, env: Env) {
    return await env.DB.prepare(
        "SELECT * FROM printers WHERE tenant_id = ? AND is_active = 1"
    ).bind(tenantId).all();
}
```

#### PrinterConnectionService → Durable Object

```typescript
// Current (Python)
class PrinterConnectionService:
    async def connect_printer(printer_id: str):
        client = bl.Printer(ip, access_code, serial)
        await client.connect()
        self.clients[printer_id] = client

// New (Durable Object managing ESP32 connections)
export class PrinterHub extends DurableObject {
    private hubs: Map<string, WebSocket> = new Map();

    async connectHub(hubId: string, ws: WebSocket) {
        this.ctx.acceptWebSocket(ws);
        ws.serializeAttachment({ hubId });
        this.hubs.set(hubId, ws);
    }

    async sendToPrinter(hubId: string, printerId: string, command: any) {
        const hub = this.hubs.get(hubId);
        hub?.send(JSON.stringify({
            type: "printer_command",
            printer_id: printerId,
            command
        }));
    }
}
```

---

## Data Migration Strategy

### Phase 1: Schema Migration

1. Export SQLite schema
2. Convert to D1-compatible SQL
3. Create D1 database with schema
4. Verify constraints and indexes

```bash
# Export current schema
sqlite3 tenant.db .schema > schema.sql

# Modify for D1 (remove unsupported features)
# - Remove AUTOINCREMENT (D1 uses INTEGER PRIMARY KEY)
# - Verify DATETIME handling
# - Check constraint syntax

# Create D1 database
wrangler d1 create printfarm-db
wrangler d1 execute printfarm-db --file=schema.sql
```

### Phase 2: Data Migration

```bash
# Export data as INSERT statements
sqlite3 tenant.db ".mode insert" ".output data.sql" "SELECT * FROM printers"
sqlite3 tenant.db ".mode insert" ".output data.sql" "SELECT * FROM products"
# ... repeat for all tables

# Import to D1
wrangler d1 execute printfarm-db --file=data.sql
```

### Phase 3: File Migration

```bash
# Upload all 3MF files to R2
for file in files/print_files/*.3mf; do
    wrangler r2 object put printfarm-files/$(basename $file) --file=$file
done

# Upload product images
for file in files/product_images/*; do
    wrangler r2 object put printfarm-files/images/$(basename $file) --file=$file
done
```

### Phase 4: Update File References

```sql
-- Update local_file_path to R2 URLs
UPDATE print_files
SET local_file_path = 'r2://printfarm-files/' || name
WHERE local_file_path LIKE '/home/pi/%';
```

---

## Key Differences After Migration

| Aspect | Current (Pi) | New (Cloud) |
|--------|--------------|-------------|
| **Deployment** | SSH + manual | Git push → auto-deploy |
| **Updates** | Per-device | All users instantly |
| **Scaling** | Buy more Pis | Automatic |
| **Uptime** | Depends on Pi | 99.99% SLA |
| **Remote Access** | Requires tunnel | Built-in |
| **Printer Connection** | Direct MQTT | Via ESP32 hub |
| **Latency to Printer** | ~1ms (LAN) | ~100-200ms (via hub) |
| **Database Backup** | Manual/Supabase | Automatic D1 backup |
| **Cost Model** | Hardware upfront | Usage-based |

---

## Files to Create for Migration

### New Cloudflare Workers Project

```
printfarm-cloud/
├── wrangler.toml              # Cloudflare configuration
├── src/
│   ├── index.ts               # Main worker entry
│   ├── api/
│   │   ├── printers.ts
│   │   ├── print-jobs.ts
│   │   ├── products.ts
│   │   └── files.ts
│   ├── durable-objects/
│   │   └── printer-hub.ts     # WebSocket + state management
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   └── r2.ts
│   └── types/
│       └── index.ts
├── migrations/
│   └── 0001_initial.sql       # D1 schema
└── frontend/                   # Unchanged React app
```

### ESP32 Firmware Project

```
printfarm-hub/
├── platformio.ini
├── src/
│   ├── main.cpp
│   ├── wifi_manager.cpp       # WiFi + Bluetooth setup
│   ├── websocket_client.cpp   # Cloud connection
│   ├── bambu_mqtt.cpp         # Printer communication
│   └── command_handler.cpp    # Process cloud commands
├── include/
│   ├── config.h
│   └── secrets.h              # Generated at pairing
└── data/
    └── index.html             # Captive portal (optional)
```

---

## Conclusion

This migration moves from a single-device architecture to a distributed cloud + edge model:

- **Cloud (Cloudflare)**: All business logic, database, file storage, user management
- **Edge (ESP32)**: Lightweight bridge between cloud and local printers
- **Printers**: Unchanged, still communicate via MQTT on LAN

The migration preserves all functionality while gaining:
- Instant updates for all users
- Remote access without tunnels
- Automatic scaling and high availability
- Simplified user onboarding (plug in hub, scan QR)
