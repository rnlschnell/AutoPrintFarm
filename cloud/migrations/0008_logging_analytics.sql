-- Migration 0008: Logging, Analytics, and Material Inventory
-- Audit trails, analytics, and material inventory tables
-- Merged from: Pi SQLite SyncLog + Supabase audit_logs/daily_analytics/material_usage + inventory tables

-- ============================================================================
-- SYNC_LOGS TABLE
-- Track synchronization operations for debugging
-- Source: Pi SQLite SyncLog model
-- ============================================================================
CREATE TABLE sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,         -- Auto-incrementing ID
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,

    -- Operation details
    operation_type TEXT                           -- Type of operation
        CHECK (operation_type IN ('INSERT', 'UPDATE', 'DELETE', 'SYNC', 'ERROR')),
    table_name TEXT,                              -- Table being synced
    record_id TEXT,                               -- ID of record being synced

    -- Status
    status TEXT                                   -- Operation status
        CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING', 'SKIPPED')),
    error_message TEXT,                           -- Error details if failed

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for sync_logs
CREATE INDEX idx_sync_logs_tenant_id ON sync_logs(tenant_id);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_created_at ON sync_logs(created_at);
CREATE INDEX idx_sync_logs_table_name ON sync_logs(table_name);

-- ============================================================================
-- AUDIT_LOGS TABLE
-- Security audit trail for sensitive operations
-- Source: Supabase audit_logs table
-- ============================================================================
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Who performed the action
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- What happened
    action TEXT NOT NULL,                         -- Action name (e.g., 'role_change', 'delete', 'login')
    table_name TEXT,                              -- Table affected
    record_id TEXT,                               -- Record ID affected

    -- Change details (stored as JSON strings)
    old_values TEXT,                              -- JSON: Previous values
    new_values TEXT,                              -- JSON: New values
    metadata TEXT,                                -- JSON: Additional context

    -- Request context
    ip_address TEXT,                              -- Client IP address
    user_agent TEXT,                              -- Client user agent

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for audit_logs
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_record_id ON audit_logs(record_id);

-- ============================================================================
-- PRINTER_FAILURES TABLE
-- Track printer failures for analytics
-- Source: Cloud architecture requirement
-- ============================================================================
CREATE TABLE printer_failures (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- References
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,
    print_job_id TEXT REFERENCES print_jobs(id) ON DELETE SET NULL,

    -- Failure details
    failure_type TEXT NOT NULL                    -- Type of failure
        CHECK (failure_type IN (
            'nozzle_clog', 'bed_adhesion', 'layer_shift', 'filament_runout',
            'power_loss', 'network_disconnect', 'firmware_error',
            'mechanical', 'thermal', 'user_cancelled', 'unknown', 'other'
        )),
    failure_reason TEXT,                          -- Detailed description
    error_code TEXT,                              -- Printer error code if available

    -- Context
    progress_at_failure INTEGER,                  -- Progress percentage when failed
    print_time_at_failure INTEGER,                -- Minutes into print when failed
    layer_at_failure INTEGER,                     -- Layer number when failed

    -- Resolution
    resolution TEXT,                              -- How it was resolved
    resolved_at TEXT,                             -- When it was resolved
    resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for printer_failures
CREATE INDEX idx_printer_failures_tenant_id ON printer_failures(tenant_id);
CREATE INDEX idx_printer_failures_printer_id ON printer_failures(printer_id);
CREATE INDEX idx_printer_failures_print_job_id ON printer_failures(print_job_id);
CREATE INDEX idx_printer_failures_failure_type ON printer_failures(failure_type);
CREATE INDEX idx_printer_failures_created_at ON printer_failures(created_at);

-- ============================================================================
-- DAILY_ANALYTICS TABLE
-- Aggregated daily metrics for reporting
-- Source: Supabase daily_analytics table
-- ============================================================================
CREATE TABLE daily_analytics (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Date
    date TEXT NOT NULL,                           -- Date (YYYY-MM-DD format)

    -- Revenue metrics (stored as cents)
    revenue INTEGER DEFAULT 0,                    -- Total revenue in cents
    profit INTEGER DEFAULT 0,                     -- Total profit in cents

    -- Print metrics
    print_completion_percentage REAL DEFAULT 0,   -- Success rate (0-100)
    jobs_completed INTEGER DEFAULT 0,             -- Number of completed jobs
    jobs_failed INTEGER DEFAULT 0,                -- Number of failed jobs
    units_produced INTEGER DEFAULT 0,             -- Total units produced

    -- Printer metrics
    active_printers INTEGER DEFAULT 0,            -- Printers that ran jobs
    total_printers INTEGER DEFAULT 0,             -- Total printers in farm
    utilization_percentage REAL DEFAULT 0,        -- Average utilization (0-100)

    -- Time metrics
    average_job_time_minutes REAL DEFAULT 0,      -- Average job duration
    total_print_time_minutes INTEGER DEFAULT 0,   -- Total printing time
    time_saved_minutes INTEGER DEFAULT 0,         -- Time saved vs manual

    -- Cost metrics (stored as cents)
    materials_cost INTEGER DEFAULT 0,             -- Material cost in cents
    labor_cost INTEGER DEFAULT 0,                 -- Labor cost in cents
    overhead_cost INTEGER DEFAULT 0,              -- Overhead in cents

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, date)
);

-- Indexes for daily_analytics
CREATE INDEX idx_daily_analytics_tenant_id ON daily_analytics(tenant_id);
CREATE INDEX idx_daily_analytics_date ON daily_analytics(date);
CREATE INDEX idx_daily_analytics_tenant_date ON daily_analytics(tenant_id, date);

-- ============================================================================
-- MATERIAL_USAGE_HISTORY TABLE
-- Track material consumption over time
-- Source: Supabase material_usage_history table
-- ============================================================================
CREATE TABLE material_usage_history (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Material reference
    material_type TEXT NOT NULL,                  -- 'filament', 'packaging', 'accessory', 'part'
    material_id TEXT NOT NULL,                    -- ID in respective inventory table

    -- Usage details
    print_job_id TEXT REFERENCES print_jobs(id) ON DELETE SET NULL,
    usage_amount REAL NOT NULL,                   -- Amount used (grams for filament, units for others)
    usage_date TEXT DEFAULT (datetime('now')),    -- When usage occurred
    reason TEXT,                                  -- Reason for usage/adjustment

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for material_usage_history
CREATE INDEX idx_material_usage_tenant_id ON material_usage_history(tenant_id);
CREATE INDEX idx_material_usage_material_type ON material_usage_history(material_type);
CREATE INDEX idx_material_usage_print_job ON material_usage_history(print_job_id);
CREATE INDEX idx_material_usage_date ON material_usage_history(usage_date);

-- ============================================================================
-- FILAMENT_INVENTORY TABLE
-- Filament stock tracking
-- Source: Supabase filament_inventory table
-- ============================================================================
CREATE TABLE filament_inventory (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Filament details
    type TEXT NOT NULL,                           -- Material type (PLA, PETG, ABS, etc.)
    color TEXT NOT NULL,                          -- Color name
    hex_code TEXT,                                -- Color hex code
    brand TEXT,                                   -- Manufacturer/brand
    diameter TEXT DEFAULT '1.75mm',               -- Filament diameter

    -- Stock levels
    remaining_grams REAL NOT NULL DEFAULT 0,      -- Remaining amount in grams
    spool_weight_grams REAL DEFAULT 1000,         -- Full spool weight
    low_threshold REAL DEFAULT 100,               -- Low stock threshold

    -- Status
    status TEXT DEFAULT 'in_stock'                -- Stock status
        CHECK (status IN ('in_stock', 'low', 'out_of_stock', 'on_order')),

    -- Location and cost
    location TEXT,                                -- Storage location
    cost_per_unit INTEGER,                        -- Cost per spool in cents
    reorder_link TEXT,                            -- Link to reorder

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for filament_inventory
CREATE INDEX idx_filament_inventory_tenant_id ON filament_inventory(tenant_id);
CREATE INDEX idx_filament_inventory_type ON filament_inventory(type);
CREATE INDEX idx_filament_inventory_color ON filament_inventory(color);
CREATE INDEX idx_filament_inventory_status ON filament_inventory(status);

-- ============================================================================
-- PACKAGING_INVENTORY TABLE
-- Packaging materials tracking
-- Source: Supabase packaging_inventory table
-- ============================================================================
CREATE TABLE packaging_inventory (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Packaging details
    type TEXT NOT NULL,                           -- Type (box, bag, label, etc.)
    name TEXT,                                    -- Display name
    color TEXT,                                   -- Color if applicable
    brand TEXT,                                   -- Brand/supplier
    size TEXT,                                    -- Size/dimensions

    -- Stock levels
    remaining_units INTEGER NOT NULL DEFAULT 0,   -- Remaining quantity
    low_threshold INTEGER DEFAULT 10,             -- Low stock threshold

    -- Status
    status TEXT DEFAULT 'in_stock'                -- Stock status
        CHECK (status IN ('in_stock', 'low', 'out_of_stock', 'on_order')),

    -- Location and cost
    location TEXT,                                -- Storage location
    cost_per_unit INTEGER,                        -- Cost per unit in cents
    reorder_link TEXT,                            -- Link to reorder

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for packaging_inventory
CREATE INDEX idx_packaging_inventory_tenant_id ON packaging_inventory(tenant_id);
CREATE INDEX idx_packaging_inventory_type ON packaging_inventory(type);
CREATE INDEX idx_packaging_inventory_status ON packaging_inventory(status);

-- ============================================================================
-- ACCESSORIES_INVENTORY TABLE
-- Accessories and consumables tracking
-- Source: Supabase accessories_inventory table
-- ============================================================================
CREATE TABLE accessories_inventory (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Accessory details
    type TEXT NOT NULL,                           -- Type of accessory
    name TEXT,                                    -- Display name
    color TEXT,                                   -- Color if applicable
    brand TEXT,                                   -- Brand/supplier
    diameter TEXT,                                -- Diameter if applicable
    size TEXT,                                    -- Size/dimensions

    -- Stock levels
    remaining_units INTEGER NOT NULL DEFAULT 0,   -- Remaining quantity
    low_threshold INTEGER DEFAULT 5,              -- Low stock threshold

    -- Status
    status TEXT DEFAULT 'in_stock'                -- Stock status
        CHECK (status IN ('in_stock', 'low', 'out_of_stock', 'on_order')),

    -- Location and cost
    location TEXT,                                -- Storage location
    cost_per_unit INTEGER,                        -- Cost per unit in cents
    reorder_link TEXT,                            -- Link to reorder

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for accessories_inventory
CREATE INDEX idx_accessories_inventory_tenant_id ON accessories_inventory(tenant_id);
CREATE INDEX idx_accessories_inventory_type ON accessories_inventory(type);
CREATE INDEX idx_accessories_inventory_status ON accessories_inventory(status);

-- ============================================================================
-- PRINTER_PARTS_INVENTORY TABLE
-- Printer spare parts tracking
-- Source: Supabase printer_parts_inventory table
-- ============================================================================
CREATE TABLE printer_parts_inventory (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Part details
    type TEXT NOT NULL,                           -- Part type (nozzle, belt, bearing, etc.)
    name TEXT,                                    -- Display name
    color TEXT,                                   -- Color if applicable
    brand TEXT,                                   -- Brand/supplier
    compatible_models TEXT,                       -- JSON array of compatible printer models

    -- Stock levels
    remaining_units INTEGER NOT NULL DEFAULT 0,   -- Remaining quantity
    low_threshold INTEGER DEFAULT 2,              -- Low stock threshold

    -- Status
    status TEXT DEFAULT 'in_stock'                -- Stock status
        CHECK (status IN ('in_stock', 'low', 'out_of_stock', 'on_order')),

    -- Location and cost
    location TEXT,                                -- Storage location
    cost_per_unit INTEGER,                        -- Cost per unit in cents
    reorder_link TEXT,                            -- Link to reorder

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for printer_parts_inventory
CREATE INDEX idx_printer_parts_inventory_tenant_id ON printer_parts_inventory(tenant_id);
CREATE INDEX idx_printer_parts_inventory_type ON printer_parts_inventory(type);
CREATE INDEX idx_printer_parts_inventory_status ON printer_parts_inventory(status);
