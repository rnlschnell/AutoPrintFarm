# PrintFarm Cloud Architecture

## Overview

This document details the architecture for migrating PrintFarm from a Raspberry Pi-based system to a cloud-native architecture using ESP32 hubs and Cloudflare's edge platform.

### Design Principles

1. **Cloudflare-First**: Use Cloudflare services for compute, database, storage, real-time, and CDN
2. **Multi-Tenant**: Each print farm (tenant) has isolated data, users, and resources
3. **Edge-Native**: Minimize latency by running compute at the edge, close to users
4. **ESP32 as Bridge**: Lightweight hubs relay between local printers and cloud - no business logic on device
5. **Schema Compatibility**: Migrate existing SQLite schema exactly to Cloudflare D1
6. **Protocol Agnostic**: Support multiple printer communication protocols (MQTT, FTP, HTTP)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐                  │
│   │   Cloudflare   │   │   Cloudflare   │   │   Cloudflare   │                  │
│   │     Pages      │   │    Workers     │   │    Durable     │                  │
│   │   (Frontend)   │   │     (API)      │   │    Objects     │                  │
│   └───────┬────────┘   └───────┬────────┘   └───────┬────────┘                  │
│           │                    │                    │                            │
│           │         ┌──────────┴──────────┐         │                            │
│           │         │                     │         │                            │
│   ┌───────▼─────────▼───┐   ┌─────────────▼─────────▼───┐   ┌────────────────┐  │
│   │    Cloudflare D1    │   │      Cloudflare R2        │   │  Cloudflare KV │  │
│   │     (Database)      │   │    (File Storage)         │   │    (Cache)     │  │
│   │                     │   │                           │   │                │  │
│   │  - Complete SQLite  │   │  - 3MF Print Files        │   │  - Sessions    │  │
│   │    schema from Pi   │   │  - Product Images         │   │  - Config      │  │
│   │  - Multi-tenant     │   │  - Thumbnails             │   │  - Rate limits │  │
│   │    via tenant_id    │   │  - Exports/Reports        │   │  - Hub tokens  │  │
│   └─────────────────────┘   └───────────────────────────┘   └────────────────┘  │
│                                                                                  │
│   ┌────────────────┐   ┌────────────────┐                                       │
│   │   Cloudflare   │   │   Cloudflare   │                                       │
│   │     Queues     │   │    Access      │                                       │
│   │  (Background)  │   │    (Auth)      │                                       │
│   └────────────────┘   └────────────────┘                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ WebSocket (wss://)
                                       │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CUSTOMER LOCATION                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────────────┐                                                            │
│   │     ESP32      │◄──── WiFi ────► Router ────► Internet                      │
│   │      Hub       │                                                            │
│   └───────┬────────┘                                                            │
│           │                                                                      │
│           │ MQTT (TLS) + FTP/FTPS + HTTP (varies by printer brand)              │
│           │                                                                      │
│   ┌───────▼────────┐   ┌────────────────┐   ┌────────────────┐                  │
│   │  Bambu Printer │   │  Prusa Printer │   │  Other Printer │                  │
│   │   (MQTT+FTP)   │   │   (HTTP API)   │   │   (Protocol)   │                  │
│   └────────────────┘   └────────────────┘   └────────────────┘                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Cloudflare Services

### Cloudflare Pages (Frontend)

**Purpose**: Host the React frontend application

**Features Used**:
- Static site hosting with global CDN
- Automatic deployments from Git
- Preview deployments for PRs
- Custom domains with automatic SSL
- Edge-side redirects and headers

**Configuration**:
- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: 18+
- Environment variables for API URL

**Benefits**:
- Zero cold starts (static files)
- Global distribution
- Free SSL certificates
- Unlimited bandwidth on paid plans

---

### Cloudflare Workers (API)

**Purpose**: Serverless API backend running at the edge

**Features Used**:
- HTTP request handling
- JWT authentication
- Database queries (D1 binding)
- File operations (R2 binding)
- WebSocket upgrades (to Durable Objects)

**Framework**: Hono (lightweight, fast, TypeScript-first)

**API Structure**:
```
/api/v1/auth/*           - Authentication (login, register, logout, refresh)
/api/v1/printers/*       - Printer CRUD and status
/api/v1/jobs/*           - Print job management
/api/v1/files/*          - File upload/download
/api/v1/products/*       - Product catalog
/api/v1/skus/*           - Product SKU management
/api/v1/inventory/*      - Stock management
/api/v1/orders/*         - Order management
/api/v1/hubs/*           - Hub claiming and management
/api/v1/worklist/*       - Worklist task management
/api/v1/assembly/*       - Assembly task management
/api/v1/colors/*         - Color preset management
/api/v1/plates/*         - Build plate type management
/api/v1/wiki/*           - Wiki/documentation management
/api/v1/camera/*         - Camera feed management
/api/v1/analytics/*      - Reports and analytics
/api/v1/integrations/*   - Shopify and other integrations
/ws/hub/:id              - Hub WebSocket connection
/ws/dashboard            - Dashboard real-time updates
```

**Benefits**:
- 0ms cold starts
- Runs in 300+ locations globally
- Automatic scaling
- Pay per request

---

### Cloudflare D1 (Database)

**Purpose**: SQLite-compatible database for all application data

**Schema**: Complete copy of existing Pi SQLite schema with multi-tenant support via `tenant_id` column on all tables.

**Features Used**:
- SQL queries via Workers binding
- Automatic replication
- Point-in-time recovery
- Database branching for development

**Multi-Tenancy Pattern**:
```sql
-- Every query includes tenant_id filter
SELECT * FROM printers WHERE tenant_id = ? AND ...
INSERT INTO print_jobs (tenant_id, ...) VALUES (?, ...)
UPDATE products SET ... WHERE tenant_id = ? AND id = ?
DELETE FROM orders WHERE tenant_id = ? AND id = ?
```

**Benefits**:
- SQLite compatibility (easy migration)
- No connection pooling needed
- Automatic backups
- Read replicas for scale

---

### Cloudflare R2 (Object Storage)

**Purpose**: Store all binary files

**Stored Objects**:
- 3MF print files
- Product images
- Thumbnails (auto-generated)
- Export files (CSV, reports)
- Firmware binaries (for ESP32 OTA)
- Camera snapshots

**Access Patterns**:
- Upload: Presigned URLs from Worker
- Download: Presigned URLs or public bucket for thumbnails
- ESP32: Downloads via presigned URL, uploads to printer via MQTT/FTP

**Bucket Structure**:
```
printfarm-files/
├── {tenant_id}/
│   ├── print-files/
│   │   └── {file_id}.3mf
│   ├── images/
│   │   └── {product_id}.jpg
│   ├── thumbnails/
│   │   └── {file_id}.png
│   └── exports/
│       └── {export_id}.csv
└── firmware/
    └── esp32-hub-{version}.bin
```

**Benefits**:
- S3-compatible API
- No egress fees
- Automatic replication
- Integrated with Workers

---

### Cloudflare Durable Objects (Real-Time State)

**Purpose**: Manage WebSocket connections and real-time state

**Durable Object Classes**:

#### 1. HubConnection
One instance per connected ESP32 hub.

**Responsibilities**:
- Maintain WebSocket connection to hub
- Track connected printers and their states
- Route commands from cloud to hub
- Relay printer status updates to database
- Handle reconnection and state recovery

**State Stored**:
- Hub ID and tenant ID
- Connected printer states (in-memory)
- Pending commands awaiting acknowledgment
- Last seen timestamp

#### 2. DashboardBroadcast
One instance per tenant for dashboard updates.

**Responsibilities**:
- Maintain WebSocket connections to all dashboard users for a tenant
- Receive updates from HubConnection instances
- Broadcast printer status changes
- Broadcast job progress updates
- Handle user subscription/unsubscription

**Message Flow**:
```
Printer → ESP32 Hub → HubConnection DO → DashboardBroadcast DO → Dashboard Users
```

**Benefits**:
- Single-threaded per instance (no race conditions)
- Automatic hibernation (cost savings)
- State survives restarts
- Global singleton pattern

---

### Cloudflare KV (Key-Value Store)

**Purpose**: Fast caching and ephemeral data

**Use Cases**:
- Session tokens (backup to D1)
- Rate limiting counters
- Feature flags
- Cached configuration
- Hub registration tokens (temporary)

**Key Patterns**:
```
session:{session_id}     → user session data
rate:{ip}:{endpoint}     → request count
config:{tenant_id}       → tenant configuration
hub_claim:{token}        → pending hub claim data (TTL: 10 min)
```

**Benefits**:
- Sub-millisecond reads
- Global replication
- Automatic expiration (TTL)
- High read throughput

---

### Cloudflare Queues (Background Jobs)

**Purpose**: Async task processing

**Queue Types**:

#### print-events
Triggered when print jobs change state.

**Consumers**:
- Update inventory on completion
- Send notifications
- Sync to external systems (Shopify)
- Generate analytics events

#### file-processing
Triggered on file upload.

**Consumers**:
- Extract 3MF metadata (print time, filament, layers)
- Generate thumbnails
- Validate file integrity

#### notifications
Triggered by various events.

**Consumers**:
- Send email notifications
- Webhook deliveries
- Push notifications (future)

#### shopify-sync
Triggered by Shopify webhooks or scheduled.

**Consumers**:
- Import new orders
- Update order fulfillment status
- Sync inventory levels

**Benefits**:
- At-least-once delivery
- Automatic retries
- Dead letter queues
- Batched processing

---

### Authentication

**Purpose**: Secure user authentication and authorization

**Supported Providers** (choose one):
- **Supabase Auth**: Managed authentication with social logins
- **Better Auth**: Self-hosted auth with full control
- **Custom JWT**: Roll your own with D1 user storage

**Implementation Notes**:
- Auth provider is abstracted behind a service interface
- JWT tokens used for API authentication
- Refresh token rotation for security
- Role-based access control (owner, admin, operator, viewer)

**User Roles**:
| Role | Permissions |
|------|-------------|
| Owner | Full access, billing, delete tenant |
| Admin | Manage users, settings, all operations |
| Operator | Manage printers, jobs, inventory |
| Viewer | Read-only access to all data |

---

## Printer Communication Protocols

### Overview

The ESP32 hub supports multiple printer communication protocols to accommodate different printer brands. All communication between the hub and printers occurs on the local network (LAN).

### Bambu Lab Printers (Primary)

**Protocols Used**:
- **MQTT over TLS** (port 8883): Status updates and commands
- **FTP over TLS** (port 990): File transfers

**MQTT Topics**:
```
device/{serial}/report    - Subscribe: Receive printer status
device/{serial}/request   - Publish: Send commands
```

**MQTT Message Types**:
```json
// Status Report (received)
{
  "print": {
    "gcode_state": "RUNNING",
    "mc_percent": 45,
    "mc_remaining_time": 3600,
    "layer_num": 50,
    "total_layer_num": 200,
    "subtask_name": "model.3mf"
  }
}

// Print Command (sent)
{
  "print": {
    "command": "project_file",
    "param": "/sdcard/model.3mf",
    "subtask_name": "model.3mf"
  }
}

// Control Command (sent)
{
  "print": {
    "command": "pause"  // pause, resume, stop
  }
}
```

**File Transfer Flow**:
1. Hub downloads 3MF from R2 via presigned HTTPS URL
2. Hub connects to printer via FTPS (port 990)
3. Hub uploads file to printer's SD card
4. Hub sends MQTT command to start print

### Prusa Printers (Future)

**Protocols Used**:
- **HTTP REST API**: Status and commands
- **PrusaLink API**: Web-based control

**Endpoints**:
```
GET  /api/v1/status      - Printer status
POST /api/v1/job         - Start print job
GET  /api/v1/job         - Current job status
DELETE /api/v1/job       - Cancel job
POST /api/v1/files/local - Upload file
```

### Other Printers (Future)

**Supported Protocols**:
- **OctoPrint API**: For OctoPrint-connected printers
- **Klipper Moonraker API**: For Klipper-based printers
- **Creality Cloud API**: For Creality printers

**Protocol Abstraction**:
The ESP32 firmware uses a protocol abstraction layer:
```c
typedef struct {
    const char* name;
    int (*connect)(printer_t* printer);
    int (*disconnect)(printer_t* printer);
    int (*get_status)(printer_t* printer, status_t* status);
    int (*send_file)(printer_t* printer, const char* url, const char* filename);
    int (*start_print)(printer_t* printer, const char* filename);
    int (*control)(printer_t* printer, control_cmd_t cmd);
} printer_protocol_t;
```

---

## Complete Database Schema (D1)

This schema is a direct migration from the current Pi SQLite database with additional tables for cloud-specific features.

### Core Tables

```sql
-- ============================================================================
-- MULTI-TENANCY
-- ============================================================================

-- Tenants (organizations)
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    subscription_tier TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'active',
    settings TEXT,  -- JSON configuration
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Users (authentication handled by external provider or custom)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    email_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tenant membership (users can belong to multiple tenants)
CREATE TABLE tenant_members (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',  -- owner, admin, operator, viewer
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, user_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_tenant_members_user ON tenant_members(user_id);

-- ============================================================================
-- HUBS
-- ============================================================================

-- ESP32 Hubs
CREATE TABLE hubs (
    id TEXT PRIMARY KEY,  -- Factory-provisioned UUID
    tenant_id TEXT,       -- NULL until claimed
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

-- ============================================================================
-- PRINTERS
-- ============================================================================

-- Printers
CREATE TABLE printers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    hub_id TEXT,  -- NULL for legacy Pi-connected printers during migration

    -- Basic information
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    manufacturer TEXT,
    firmware_version TEXT,
    printer_id INTEGER,  -- Simple numeric ID for display

    -- Connection details
    connection_type TEXT DEFAULT 'bambu',  -- bambu, prusa, octoprint, klipper, other
    ip_address TEXT,
    serial_number TEXT,
    access_code TEXT,  -- Encrypted

    -- Status
    status TEXT DEFAULT 'offline',  -- idle, printing, paused, maintenance, offline, error
    is_connected INTEGER DEFAULT 0,
    last_connection_attempt INTEGER,
    connection_error TEXT,

    -- Current state
    current_color TEXT,
    current_color_hex TEXT,
    current_filament_type TEXT,
    current_build_plate TEXT,
    filament_level INTEGER DEFAULT 0,
    nozzle_size REAL,
    location TEXT,

    -- Maintenance
    total_print_time INTEGER DEFAULT 0,
    last_maintenance_date INTEGER,
    in_maintenance INTEGER DEFAULT 0,
    maintenance_type TEXT,

    -- Management
    is_active INTEGER DEFAULT 1,
    cleared INTEGER DEFAULT 1,  -- Bed cleared after print
    sort_order INTEGER DEFAULT 0,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE SET NULL,
    UNIQUE (tenant_id, name),
    UNIQUE (tenant_id, printer_id)
);

CREATE INDEX idx_printers_tenant ON printers(tenant_id);
CREATE INDEX idx_printers_hub ON printers(hub_id);
CREATE INDEX idx_printers_status ON printers(status);
CREATE INDEX idx_printers_connected ON printers(is_connected);
CREATE INDEX idx_printers_sort ON printers(tenant_id, sort_order);

-- ============================================================================
-- PRODUCTS & INVENTORY
-- ============================================================================

-- Products
CREATE TABLE products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- Product information
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    image_url TEXT,

    -- Print settings
    print_file_id TEXT,
    file_name TEXT,
    printer_priority TEXT,  -- JSON array of preferred printer IDs

    -- Post-processing
    requires_assembly INTEGER DEFAULT 0,
    requires_post_processing INTEGER DEFAULT 0,

    -- Documentation
    wiki_id TEXT,  -- Link to wiki article

    -- Status
    is_active INTEGER DEFAULT 1,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_active ON products(is_active);

-- Product SKUs (variants by color/material)
CREATE TABLE product_skus (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,

    -- SKU information
    sku TEXT NOT NULL,
    color TEXT NOT NULL,
    filament_type TEXT,
    hex_code TEXT,

    -- Inventory
    quantity INTEGER DEFAULT 1,  -- Units per print
    stock_level INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 0,

    -- Pricing (stored as cents)
    price INTEGER,

    -- Status
    is_active INTEGER DEFAULT 1,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_skus_product ON product_skus(product_id);
CREATE INDEX idx_skus_tenant ON product_skus(tenant_id);
CREATE INDEX idx_skus_sku ON product_skus(sku);

-- Color Presets
CREATE TABLE color_presets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    color_name TEXT NOT NULL,
    hex_code TEXT NOT NULL,
    filament_type TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,

    created_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, color_name, filament_type)
);

CREATE INDEX idx_color_presets_tenant ON color_presets(tenant_id);

-- Build Plate Types
CREATE TABLE build_plate_types (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_build_plates_tenant ON build_plate_types(tenant_id);

-- ============================================================================
-- PRINT FILES
-- ============================================================================

-- Print Files (3MF metadata)
CREATE TABLE print_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_id TEXT,

    -- File information
    name TEXT NOT NULL,
    file_key TEXT NOT NULL,  -- R2 object key
    file_size_bytes INTEGER,
    number_of_units INTEGER DEFAULT 1,

    -- 3MF Metadata (extracted from file)
    print_time_seconds INTEGER,
    filament_weight_grams REAL,
    filament_length_meters REAL,
    filament_type TEXT,
    printer_model_id TEXT,  -- Bambu model code: N1, N2S, P1P, X1, etc.
    nozzle_diameter REAL,
    layer_count INTEGER,
    object_count INTEGER DEFAULT 1,
    curr_bed_type TEXT,  -- Required bed type
    default_print_profile TEXT,

    -- Thumbnails
    thumbnail_url TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_files_tenant ON print_files(tenant_id);
CREATE INDEX idx_files_product ON print_files(product_id);

-- ============================================================================
-- PRINT JOBS
-- ============================================================================

-- Print Jobs
CREATE TABLE print_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    printer_id TEXT,
    print_file_id TEXT NOT NULL,
    product_sku_id TEXT,
    submitted_by TEXT,  -- User ID

    -- Job information
    file_name TEXT NOT NULL,
    status TEXT DEFAULT 'queued',  -- queued, processing, uploaded, printing, paused, completed, failed, cancelled
    color TEXT NOT NULL,
    filament_type TEXT NOT NULL,
    material_type TEXT NOT NULL,
    number_of_units INTEGER DEFAULT 1,

    -- Print metrics
    filament_needed_grams INTEGER,  -- Stored as centigrams for precision
    estimated_print_time_minutes INTEGER,
    actual_print_time_minutes INTEGER,
    progress_percentage INTEGER DEFAULT 0,

    -- Printer tracking
    bambu_job_id TEXT,  -- Printer's internal job ID
    printer_numeric_id INTEGER,
    last_sync_time INTEGER,

    -- Queue management
    priority INTEGER DEFAULT 0,
    failure_reason TEXT,

    -- SKU tracking
    requires_assembly INTEGER DEFAULT 0,
    quantity_per_print INTEGER DEFAULT 1,

    -- Denormalized fields for reporting
    product_id TEXT,
    product_name TEXT,
    sku_name TEXT,
    printer_model TEXT,
    printer_name TEXT,

    -- Timestamps
    time_submitted INTEGER,
    time_started INTEGER,
    time_completed INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL,
    FOREIGN KEY (print_file_id) REFERENCES print_files(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_sku_id) REFERENCES product_skus(id) ON DELETE SET NULL
);

CREATE INDEX idx_jobs_tenant ON print_jobs(tenant_id);
CREATE INDEX idx_jobs_printer ON print_jobs(printer_id);
CREATE INDEX idx_jobs_status ON print_jobs(status);
CREATE INDEX idx_jobs_priority ON print_jobs(priority);
CREATE INDEX idx_jobs_submitted ON print_jobs(time_submitted);

-- ============================================================================
-- FINISHED GOODS & INVENTORY
-- ============================================================================

-- Finished Goods (completed inventory)
CREATE TABLE finished_goods (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    product_sku_id TEXT NOT NULL,
    print_job_id TEXT,

    -- Product info (denormalized)
    sku TEXT NOT NULL,
    color TEXT NOT NULL,
    material TEXT NOT NULL,

    -- Stock tracking
    current_stock INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 5,
    quantity_per_sku INTEGER DEFAULT 1,

    -- Pricing (stored as cents)
    unit_price INTEGER DEFAULT 0,
    extra_cost INTEGER DEFAULT 0,
    profit_margin INTEGER DEFAULT 0,  -- Percentage * 100

    -- Assembly tracking
    requires_assembly INTEGER DEFAULT 0,
    quantity_assembled INTEGER DEFAULT 0,
    quantity_needs_assembly INTEGER DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'active',
    image_url TEXT,
    is_active INTEGER DEFAULT 1,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_sku_id) REFERENCES product_skus(id) ON DELETE CASCADE,
    FOREIGN KEY (print_job_id) REFERENCES print_jobs(id) ON DELETE SET NULL
);

CREATE INDEX idx_finished_goods_tenant ON finished_goods(tenant_id);
CREATE INDEX idx_finished_goods_sku ON finished_goods(product_sku_id);

-- ============================================================================
-- TASKS & WORKFLOW
-- ============================================================================

-- Assembly Tasks
CREATE TABLE assembly_tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    finished_good_id TEXT NOT NULL,
    assigned_to TEXT,  -- User ID

    -- Task info
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',  -- pending, in_progress, completed
    notes TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (finished_good_id) REFERENCES finished_goods(id) ON DELETE CASCADE
);

CREATE INDEX idx_assembly_tenant ON assembly_tasks(tenant_id);
CREATE INDEX idx_assembly_status ON assembly_tasks(status);
CREATE INDEX idx_assembly_assigned ON assembly_tasks(assigned_to);

-- Worklist Tasks
CREATE TABLE worklist_tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    assembly_task_id TEXT,
    printer_id TEXT,
    assigned_to TEXT,  -- User ID

    -- Task info
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    task_type TEXT NOT NULL,  -- assembly, filament_change, collection, maintenance, quality_check
    priority TEXT DEFAULT 'medium',  -- low, medium, high
    status TEXT DEFAULT 'pending',  -- pending, in_progress, completed, cancelled
    order_number TEXT,

    -- Time tracking
    estimated_time_minutes INTEGER,
    actual_time_minutes INTEGER,
    started_at INTEGER,
    completed_at INTEGER,
    due_date INTEGER,

    -- Metadata (JSON)
    metadata TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (assembly_task_id) REFERENCES assembly_tasks(id) ON DELETE SET NULL,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL
);

CREATE INDEX idx_worklist_tenant ON worklist_tasks(tenant_id);
CREATE INDEX idx_worklist_status ON worklist_tasks(status);
CREATE INDEX idx_worklist_type ON worklist_tasks(task_type);
CREATE INDEX idx_worklist_assigned ON worklist_tasks(assigned_to);

-- ============================================================================
-- ORDERS & INTEGRATIONS
-- ============================================================================

-- Orders (from Shopify or manual)
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- External reference
    external_id TEXT,  -- Shopify/WooCommerce order ID
    source TEXT DEFAULT 'manual',  -- shopify, woocommerce, manual, api

    -- Customer info
    customer_name TEXT,
    customer_email TEXT,
    shipping_address TEXT,  -- JSON

    -- Order details
    status TEXT DEFAULT 'pending',  -- pending, processing, fulfilled, cancelled
    priority INTEGER DEFAULT 0,
    notes TEXT,

    -- Shopify sync
    shopify_order_number TEXT,
    shopify_fulfillment_id TEXT,
    last_synced_at INTEGER,

    -- Timestamps
    order_date INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_external ON orders(external_id);

-- Order Items
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_sku_id TEXT,

    -- Item details
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    quantity_fulfilled INTEGER DEFAULT 0,
    unit_price INTEGER,  -- Cents

    -- Timestamps
    created_at INTEGER NOT NULL,

    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_sku_id) REFERENCES product_skus(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================================
-- WIKI / DOCUMENTATION
-- ============================================================================

-- Wiki Articles
CREATE TABLE wiki_articles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- Article info
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,  -- Markdown content

    -- Organization
    category TEXT,
    tags TEXT,  -- JSON array
    sort_order INTEGER DEFAULT 0,

    -- Status
    is_published INTEGER DEFAULT 0,

    -- Authorship
    created_by TEXT,
    updated_by TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_wiki_tenant ON wiki_articles(tenant_id);
CREATE INDEX idx_wiki_category ON wiki_articles(category);
CREATE INDEX idx_wiki_published ON wiki_articles(is_published);

-- ============================================================================
-- CAMERA
-- ============================================================================

-- Camera Configurations
CREATE TABLE cameras (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    printer_id TEXT,
    hub_id TEXT,

    -- Camera info
    name TEXT NOT NULL,
    stream_url TEXT,
    snapshot_url TEXT,
    camera_type TEXT DEFAULT 'bambu',  -- bambu, ip, usb

    -- Status
    is_active INTEGER DEFAULT 1,
    last_snapshot_at INTEGER,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
    FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE SET NULL
);

CREATE INDEX idx_cameras_tenant ON cameras(tenant_id);
CREATE INDEX idx_cameras_printer ON cameras(printer_id);

-- ============================================================================
-- AUTOMATION
-- ============================================================================

-- Automation Rules
CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,

    -- Rule info
    name TEXT NOT NULL,
    description TEXT,

    -- Trigger
    trigger_type TEXT NOT NULL,  -- print_complete, print_failed, printer_idle, order_received, inventory_low, schedule
    trigger_config TEXT,  -- JSON configuration

    -- Conditions and Actions
    conditions TEXT,  -- JSON array of conditions
    actions TEXT NOT NULL,  -- JSON array of actions

    -- Status
    is_active INTEGER DEFAULT 1,
    last_triggered_at INTEGER,
    trigger_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_tenant ON automation_rules(tenant_id);
CREATE INDEX idx_automation_trigger ON automation_rules(trigger_type);
CREATE INDEX idx_automation_active ON automation_rules(is_active);

-- ============================================================================
-- LOGGING & AUDIT
-- ============================================================================

-- Sync Logs (for debugging)
CREATE TABLE sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    operation_type TEXT,  -- INSERT, UPDATE, DELETE, ERROR
    table_name TEXT,
    record_id TEXT,
    status TEXT,  -- SUCCESS, FAILED, PENDING
    error_message TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sync_logs_tenant ON sync_logs(tenant_id);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_created ON sync_logs(created_at);

-- Audit Log
CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,

    -- Action details
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,  -- JSON

    -- Request info
    ip_address TEXT,
    user_agent TEXT,

    -- Timestamp
    created_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- Printer Failure Tracking
CREATE TABLE printer_failures (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    printer_id TEXT NOT NULL,
    print_job_id TEXT,

    -- Failure info
    error_code TEXT,
    error_message TEXT,
    failure_type TEXT,  -- mechanical, filament, bed_adhesion, network, unknown

    -- Context
    layer_number INTEGER,
    progress_percentage INTEGER,
    temperatures TEXT,  -- JSON

    -- Resolution
    resolved INTEGER DEFAULT 0,
    resolution_notes TEXT,
    resolved_at INTEGER,

    -- Timestamp
    created_at INTEGER NOT NULL,

    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
    FOREIGN KEY (print_job_id) REFERENCES print_jobs(id) ON DELETE SET NULL
);

CREATE INDEX idx_failures_tenant ON printer_failures(tenant_id);
CREATE INDEX idx_failures_printer ON printer_failures(printer_id);
CREATE INDEX idx_failures_resolved ON printer_failures(resolved);
```

---

## ESP32 Hub Architecture

### Hardware

**Recommended**: ESP32-S3-WROOM-1
- WiFi 802.11 b/g/n
- 512KB SRAM + 8MB PSRAM (for file buffering)
- 16MB Flash
- Dual-core 240MHz

### Firmware Components

```
┌─────────────────────────────────────────────────────────────┐
│                    ESP32 Firmware                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │    WiFi      │  │   Config     │  │     OTA      │       │
│  │   Manager    │  │   Storage    │  │   Updater    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  WebSocket   │  │   Protocol   │  │   Printer    │       │
│  │   Client     │  │   Manager    │  │   Discovery  │       │
│  │  (to Cloud)  │  │  (MQTT/FTP)  │  │   (mDNS)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Protocol Bridge                          │    │
│  │  Cloud Commands ←→ Printer Protocol (MQTT/FTP/HTTP)  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Core Responsibilities

1. **WiFi Manager**
   - Store credentials in NVS (encrypted)
   - Auto-reconnect with exponential backoff
   - Captive portal for initial setup

2. **WebSocket Client**
   - Persistent connection to Cloudflare Worker
   - Binary message support
   - Heartbeat/ping-pong
   - Auto-reconnect on disconnect

3. **Protocol Manager**
   - MQTT client for Bambu printers (port 8883, TLS)
   - FTP client for file transfers (port 990, FTPS)
   - HTTP client for Prusa/OctoPrint (future)
   - Handle multiple printers (up to 5)

4. **Printer Discovery**
   - mDNS/SSDP for local printer discovery
   - Report discovered printers to cloud

5. **OTA Updater**
   - Check for firmware updates on boot
   - Download from R2
   - Dual-partition for rollback safety

### Message Protocol (Hub ↔ Cloud)

**Hub → Cloud**:
```json
{"type": "hub_hello", "hub_id": "...", "firmware": "1.0.0"}
{"type": "printer_status", "printer_id": "...", "status": {...}}
{"type": "file_progress", "job_id": "...", "bytes_sent": 1000, "bytes_total": 5000}
{"type": "command_ack", "command_id": "...", "success": true}
{"type": "printer_discovered", "printers": [...]}
```

**Cloud → Hub**:
```json
{"type": "configure_printer", "command_id": "...", "action": "add", "printer": {...}}
{"type": "print_command", "command_id": "...", "printer_id": "...", "action": "start", "file_url": "..."}
{"type": "printer_command", "command_id": "...", "printer_id": "...", "action": "pause"}
{"type": "discover_printers", "command_id": "..."}
```

---

## Dashboard WebSocket Protocol

The dashboard receives real-time updates via WebSocket connection to `/ws/dashboard`.

### Authentication
```json
// Client sends after connection
{"type": "auth", "token": "jwt_token_here"}

// Server responds
{"type": "auth_success", "user_id": "...", "tenant_id": "..."}
// or
{"type": "auth_error", "message": "Invalid token"}
```

### Server → Client Messages

```json
// Printer status update
{
  "type": "printer_status",
  "printer_id": "...",
  "status": "printing",
  "progress": 45,
  "remaining_minutes": 60,
  "current_layer": 50,
  "total_layers": 200
}

// Job status update
{
  "type": "job_update",
  "job_id": "...",
  "status": "completed",
  "actual_time_minutes": 120
}

// Hub connection status
{
  "type": "hub_status",
  "hub_id": "...",
  "is_online": true,
  "printer_count": 3
}

// Inventory alert
{
  "type": "inventory_alert",
  "sku_id": "...",
  "sku": "WIDGET-RED",
  "current_stock": 2,
  "threshold": 5
}

// New order received
{
  "type": "new_order",
  "order_id": "...",
  "source": "shopify",
  "item_count": 3
}
```

### Client → Server Messages

```json
// Subscribe to specific printers
{
  "type": "subscribe",
  "printers": ["printer_id_1", "printer_id_2"]
}

// Unsubscribe
{
  "type": "unsubscribe",
  "printers": ["printer_id_1"]
}

// Ping (keepalive)
{
  "type": "ping"
}
```

---

## Multi-Tenancy Model

### Tenant Hierarchy

```
Tenant (Organization)
│
├── Users
│   ├── Owner (full access, billing)
│   ├── Admin (manage users, settings)
│   ├── Operator (manage printers, jobs)
│   └── Viewer (read-only)
│
├── Hubs
│   └── Printers (connected to hub)
│       └── Cameras
│
├── Print Files
│
├── Products
│   └── SKUs (variants with colors/materials)
│
├── Finished Goods (inventory)
│
├── Print Jobs
│
├── Orders
│
├── Worklist Tasks
│
├── Assembly Tasks
│
├── Wiki Articles
│
└── Automation Rules
```

### Data Isolation

**Database Level**:
- Every table has `tenant_id` column
- All queries filtered by `tenant_id`
- Enforced in middleware, not trusted from client

**Storage Level**:
- R2 keys prefixed with `{tenant_id}/`
- Presigned URLs scoped to tenant path

**Real-Time Level**:
- Durable Objects namespaced by hub ID and tenant ID
- Broadcasts scoped to tenant

---

## File Transfer Flow

### Print Job Execution

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  User    │  │  Worker  │  │    R2    │  │   ESP32  │  │ Printer  │
│ Browser  │  │  (API)   │  │ (Storage)│  │   Hub    │  │(MQTT/FTP)│
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │             │             │
     │ Start Job   │             │             │             │
     │────────────>│             │             │             │
     │             │             │             │             │
     │             │ Get File URL│             │             │
     │             │────────────>│             │             │
     │             │             │             │             │
     │             │ Presigned   │             │             │
     │             │<────────────│             │             │
     │             │             │             │             │
     │             │ Send Command (via DO)     │             │
     │             │────────────────────────────>             │
     │             │             │             │             │
     │             │             │  Download   │             │
     │             │             │<────────────│             │
     │             │             │             │             │
     │             │             │  File Data  │             │
     │             │             │────────────>│             │
     │             │             │             │             │
     │             │             │             │ FTP Upload  │
     │             │             │             │────────────>│
     │             │             │             │             │
     │             │             │             │ Progress    │
     │             │             │             │<────────────│
     │             │             │             │             │
     │ Progress Updates (via WebSocket)        │             │
     │<─────────────────────────────────────────             │
     │             │             │             │             │
     │             │             │             │ MQTT Start  │
     │             │             │             │────────────>│
     │             │             │             │             │
     │             │             │             │ Printing... │
     │             │             │             │<────────────│
     │             │             │             │             │
     │ Status Updates (via WebSocket)          │             │
     │<─────────────────────────────────────────             │
     │             │             │             │             │
```

---

## Project Structure

```
AutoPrintFarm/
├── cloud/                          # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts               # Hono app entry point
│   │   ├── routes/
│   │   │   ├── auth.ts            # Authentication endpoints
│   │   │   ├── printers.ts        # Printer CRUD
│   │   │   ├── jobs.ts            # Print job management
│   │   │   ├── files.ts           # File upload/download
│   │   │   ├── products.ts        # Product catalog
│   │   │   ├── skus.ts            # Product SKUs
│   │   │   ├── inventory.ts       # Stock management
│   │   │   ├── orders.ts          # Order management
│   │   │   ├── hubs.ts            # Hub management
│   │   │   ├── worklist.ts        # Worklist tasks
│   │   │   ├── assembly.ts        # Assembly tasks
│   │   │   ├── colors.ts          # Color presets
│   │   │   ├── plates.ts          # Build plate types
│   │   │   ├── wiki.ts            # Wiki articles
│   │   │   ├── cameras.ts         # Camera management
│   │   │   ├── automation.ts      # Automation rules
│   │   │   ├── analytics.ts       # Reports
│   │   │   └── integrations.ts    # Shopify, etc.
│   │   ├── durable-objects/
│   │   │   ├── hub-connection.ts  # Hub WebSocket handler
│   │   │   └── dashboard-broadcast.ts  # Dashboard broadcaster
│   │   ├── middleware/
│   │   │   ├── auth.ts            # JWT validation
│   │   │   └── tenant.ts          # Tenant scoping
│   │   ├── lib/
│   │   │   ├── db.ts              # D1 helpers
│   │   │   ├── r2.ts              # R2 helpers
│   │   │   └── crypto.ts          # Encryption helpers
│   │   ├── queues/
│   │   │   ├── print-events.ts    # Print event handler
│   │   │   ├── file-processing.ts # File processor
│   │   │   └── notifications.ts   # Notification sender
│   │   └── types/
│   │       └── index.ts           # TypeScript types
│   ├── migrations/
│   │   └── 0001_initial.sql       # D1 schema
│   ├── wrangler.toml              # Cloudflare configuration
│   ├── package.json
│   └── tsconfig.json
│
├── firmware/                       # ESP32 Hub Firmware
│   ├── src/
│   │   ├── main.c                 # Entry point
│   │   ├── wifi_manager.c         # WiFi connection
│   │   ├── websocket_client.c     # Cloud connection
│   │   ├── mqtt_client.c          # Bambu MQTT
│   │   ├── ftp_client.c           # File transfers
│   │   ├── protocol_bridge.c      # Message translation
│   │   ├── printer_discovery.c    # mDNS/SSDP
│   │   └── ota_updater.c          # Firmware updates
│   ├── include/
│   │   ├── config.h
│   │   └── messages.h
│   ├── platformio.ini
│   └── README.md
│
├── frontend/                       # React Frontend
│   ├── src/
│   │   ├── pages/                 # Route components
│   │   ├── components/            # UI components
│   │   ├── hooks/                 # Custom hooks
│   │   ├── services/              # API clients
│   │   ├── contexts/              # React contexts
│   │   └── lib/                   # Utilities
│   ├── package.json
│   └── vite.config.ts
│
├── docs/                           # Documentation
│   ├── PRINTFARM_CURRENT_ARCHITECTURE_AND_MIGRATION.md
│   └── ESP32_CLOUD_ARCHITECTURE_SPECIFICATION.md
│
├── PRINTFARM_CLOUD_ARCHITECTURE.md # This document
├── CLAUDE.md                       # Development guide
└── README.md
```

---

## Deployment

### Cloudflare Configuration (wrangler.toml)

```toml
name = "printfarm-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Durable Objects
[[durable_objects.bindings]]
name = "HUB_CONNECTIONS"
class_name = "HubConnection"

[[durable_objects.bindings]]
name = "DASHBOARD_BROADCASTS"
class_name = "DashboardBroadcast"

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["HubConnection", "DashboardBroadcast"]

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "printfarm"
database_id = "xxxxx"

# R2 Storage
[[r2_buckets]]
binding = "R2"
bucket_name = "printfarm-files"

# KV Namespace
[[kv_namespaces]]
binding = "KV"
id = "xxxxx"

# Queues
[[queues.producers]]
binding = "PRINT_EVENTS"
queue = "print-events"

[[queues.producers]]
binding = "FILE_PROCESSING"
queue = "file-processing"

[[queues.producers]]
binding = "NOTIFICATIONS"
queue = "notifications"

[[queues.consumers]]
queue = "print-events"
max_batch_size = 10
max_batch_timeout = 30

[[queues.consumers]]
queue = "file-processing"
max_batch_size = 5
max_batch_timeout = 60

[[queues.consumers]]
queue = "notifications"
max_batch_size = 10
max_batch_timeout = 5

# Environment Variables
[vars]
ENVIRONMENT = "production"
API_VERSION = "v1"
```

### Deployment Commands

```bash
# Deploy API
cd cloud
npm install
npm run deploy

# Apply database migrations
wrangler d1 migrations apply printfarm

# Deploy frontend
cd frontend
npm run build
wrangler pages deploy dist

# Upload firmware to R2
wrangler r2 object put printfarm-files/firmware/esp32-hub-1.0.0.bin --file=firmware/.pio/build/release/firmware.bin
```

---

## Security

### Data Protection

| Data | Protection Method |
|------|-------------------|
| Passwords | Argon2id hashing (if using custom auth) |
| Printer access codes | AES-256-GCM encryption (stored encrypted in D1) |
| JWT tokens | RS256 or HS256 signing |
| Data in transit | TLS 1.3 (Cloudflare managed) |
| Data at rest | Encrypted (Cloudflare managed) |

### Multi-Tenant Isolation

1. **Database**: Every query includes `tenant_id` filter
2. **Storage**: R2 paths prefixed with tenant ID
3. **Real-time**: Durable Objects scoped to tenant
4. **API**: Middleware validates tenant membership before any operation

### Hub Authentication

1. Hub has factory-provisioned UUID + secret
2. Hub authenticates via HMAC signature on connect
3. Hub must be claimed by tenant before accepting commands
4. Commands validated against hub's tenant

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Auth endpoints | 10 req/min per IP |
| API endpoints | 100 req/min per user |
| File uploads | 20 req/hour per tenant |
| WebSocket connections | 10 per user |

---

## Monitoring & Operations

### Metrics to Track

| Metric | Purpose |
|--------|---------|
| Hub connection count | System health |
| Printer online ratio | Reliability |
| Print success rate | Quality |
| API latency (p50, p95, p99) | Performance |
| Error rate by endpoint | Debugging |
| Queue depth | Backpressure |
| D1 query latency | Database health |

### Alerting

| Condition | Severity | Action |
|-----------|----------|--------|
| Hub offline > 5 min | Warning | Notify tenant |
| Print failure rate > 10% | Warning | Investigate |
| API error rate > 1% | Critical | On-call page |
| Queue depth > 1000 | Warning | Scale consumers |
| D1 latency > 100ms | Warning | Investigate |

### Disaster Recovery

| Scenario | Recovery |
|----------|----------|
| D1 corruption | Point-in-time recovery (Cloudflare managed) |
| R2 data loss | Cross-region replication (Cloudflare managed) |
| Hub firmware bug | OTA rollback to previous version |
| Full outage | Hubs queue messages, sync on reconnect |

---

## Migration Strategy

### Phase 1: Deploy Cloud Infrastructure
1. Set up Cloudflare account and services
2. Create D1 database with complete schema
3. Deploy Workers API (mirrors Pi API)
4. Deploy frontend to Pages

### Phase 2: Data Migration
1. Export Pi SQLite database
2. Import to D1
3. Upload files from Pi to R2
4. Update file path references

### Phase 3: ESP32 Development
1. Develop and test firmware
2. Test with single printer
3. Validate file transfer (MQTT + FTP)
4. Test reconnection scenarios

### Phase 4: Parallel Operation
1. Run Pi and cloud in parallel
2. Dual-write to both systems
3. Validate data consistency
4. Gradual traffic migration

### Phase 5: Cutover
1. Deploy ESP32 hub at location
2. Configure printers on hub
3. Verify functionality
4. Decommission Pi

---

## Cost Estimation

### Cloudflare Pricing (100 hubs, 500 printers, 10 users)

| Service | Usage Estimate | Monthly Cost |
|---------|----------------|--------------|
| **Workers** | 10M requests | ~$5 |
| **Durable Objects** | 100 objects, 100 GB-hours | ~$15 |
| **D1** | 5GB storage, 25M reads, 1M writes | ~$5 |
| **R2** | 100GB storage, 10M Class A, 50M Class B | ~$5 |
| **Pages** | Unlimited static hosting | Free |
| **KV** | 1GB, 10M reads | ~$5 |
| **Queues** | 1M messages | ~$1 |
| **Total** | | **~$36/month** |

---

## Summary

This architecture leverages Cloudflare's edge platform to provide:

- **Global low-latency access** via Workers and Pages
- **Reliable real-time updates** via Durable Objects
- **Scalable storage** via D1 and R2
- **Simple multi-tenancy** via tenant ID scoping
- **Minimal edge hardware** via ESP32 hubs
- **Zero server management** via serverless architecture
- **Multiple printer support** via protocol abstraction (MQTT, FTP, HTTP)
- **Complete feature parity** with existing Pi system

The ESP32 hub acts purely as a bridge - all business logic, data, and user management lives in Cloudflare. This allows instant updates, automatic scaling, and centralized management while maintaining local printer communication for reliability.
