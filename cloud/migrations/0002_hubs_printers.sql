-- Migration 0002: Hubs and Printers
-- ESP32 hub management and printer fleet tables
-- Merged from: Pi SQLite printers + Cloud architecture hubs

-- ============================================================================
-- HUBS TABLE
-- ESP32 hub devices that bridge local printers to cloud
-- Source: Cloud architecture (NEW table)
-- ============================================================================
CREATE TABLE hubs (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,  -- NULL = unclaimed
    name TEXT,                                    -- User-assigned name
    secret_hash TEXT NOT NULL,                    -- HMAC secret for authentication
    firmware_version TEXT,                        -- Current firmware version
    hardware_version TEXT,                        -- Hardware revision
    is_online INTEGER DEFAULT 0,                  -- Boolean: currently connected
    last_seen_at TEXT,                            -- Last heartbeat timestamp
    ip_address TEXT,                              -- Hub's IP address
    mac_address TEXT,                             -- MAC address for identification
    claimed_at TEXT,                              -- When hub was claimed by tenant
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for hubs
CREATE INDEX idx_hubs_tenant_id ON hubs(tenant_id);
CREATE INDEX idx_hubs_is_online ON hubs(is_online);
CREATE INDEX idx_hubs_mac_address ON hubs(mac_address);

-- ============================================================================
-- PRINTERS TABLE
-- Printer fleet management with all columns from Pi SQLite + Supabase
-- Source: Pi SQLite database.py Printer model (comprehensive)
-- ============================================================================
CREATE TABLE printers (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hub_id TEXT REFERENCES hubs(id) ON DELETE SET NULL,  -- Which hub manages this printer

    -- Basic printer information (from both)
    name TEXT NOT NULL,                           -- User-assigned name
    model TEXT NOT NULL,                          -- Printer model (e.g., "A1 Mini", "X1 Carbon")
    manufacturer TEXT,                            -- Pi: Manufacturer name
    firmware_version TEXT,                        -- Current firmware version

    -- Usage and maintenance (from both)
    total_print_time INTEGER DEFAULT 0,           -- Total print time in minutes
    last_maintenance_date TEXT,                   -- Date of last maintenance (DATE as TEXT)

    -- Status information (merged)
    status TEXT DEFAULT 'idle'                    -- Current printer status
        CHECK (status IN ('idle', 'printing', 'paused', 'maintenance', 'offline', 'error')),
    current_color TEXT,                           -- Currently loaded filament color name
    current_color_hex TEXT,                       -- Pi: Hex code of current color
    current_filament_type TEXT,                   -- Currently loaded filament type (PLA, PETG, etc.)
    current_build_plate TEXT,                     -- Pi: Current build plate type
    filament_level INTEGER DEFAULT 0,             -- Pi: Filament amount in grams
    nozzle_size REAL,                             -- Pi: Nozzle size in mm (0.2, 0.4, 0.6, 0.8)
    location TEXT,                                -- Physical location description

    -- Connection details (from Pi SQLite)
    connection_type TEXT DEFAULT 'bambu'          -- Pi: Type of printer connection
        CHECK (connection_type IN ('bambu', 'prusa', 'octoprint', 'klipper', 'other')),
    ip_address TEXT,                              -- Pi: Printer's IP address
    serial_number TEXT,                           -- Pi: Printer serial number
    access_code TEXT,                             -- Pi: Encrypted access code for Bambu printers

    -- Connection status (from Pi SQLite)
    is_connected INTEGER DEFAULT 0,               -- Pi: Currently connected to hub
    last_connection_attempt TEXT,                 -- Pi: Last connection attempt timestamp
    connection_error TEXT,                        -- Pi: Last connection error message

    -- Management fields (from Pi SQLite)
    is_active INTEGER DEFAULT 1,                  -- Boolean: printer is active
    cleared INTEGER DEFAULT 1,                    -- Pi: Print bed has been cleared
    sort_order INTEGER DEFAULT 0,                 -- Pi: Display order in UI
    printer_id INTEGER,                           -- Pi: Simple numeric ID for printer manager

    -- Maintenance tracking (from Pi SQLite)
    in_maintenance INTEGER DEFAULT 0,             -- Pi: Currently in maintenance mode
    maintenance_type TEXT,                        -- Pi: Type of maintenance being performed

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraints (from Pi SQLite)
    UNIQUE(tenant_id, name),
    UNIQUE(tenant_id, printer_id)
);

-- Indexes for printers (from Pi SQLite + additional)
CREATE INDEX idx_printers_tenant_id ON printers(tenant_id);
CREATE INDEX idx_printers_hub_id ON printers(hub_id);
CREATE INDEX idx_printers_status ON printers(status);
CREATE INDEX idx_printers_sort_order ON printers(tenant_id, sort_order);
CREATE INDEX idx_printers_connection ON printers(tenant_id, is_connected);
CREATE INDEX idx_printers_ip_address ON printers(ip_address);
CREATE INDEX idx_printers_serial_number ON printers(serial_number);
CREATE INDEX idx_printers_is_active ON printers(tenant_id, is_active);
