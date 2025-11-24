-- Migration 0004: Print Files and Jobs
-- File management and print queue tables
-- Merged from: Pi SQLite PrintFile/PrintJob models + Supabase tables

-- ============================================================================
-- PRINT_FILES TABLE
-- 3MF file metadata with all merged columns
-- Source: Pi SQLite PrintFile model + Supabase print_files table
-- ============================================================================
CREATE TABLE print_files (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,  -- Supabase: linked product

    -- File information (from both)
    name TEXT NOT NULL,                           -- File name
    file_size_bytes INTEGER,                      -- File size in bytes

    -- Pi SQLite specific fields
    number_of_units INTEGER DEFAULT 1,            -- Pi: Number of units per print
    local_file_path TEXT,                         -- Pi: Path to file on Pi filesystem (legacy)
    r2_key TEXT,                                  -- Cloud: R2 object key

    -- 3MF Metadata (from Pi SQLite - extracted from file)
    print_time_seconds INTEGER,                   -- Pi: Print duration estimate in seconds
    filament_weight_grams REAL,                   -- Pi: Total filament weight in grams
    filament_length_meters REAL,                  -- Pi: Total filament length in meters
    filament_type TEXT,                           -- Pi: Material type (PLA, PETG, ABS, etc.)
    printer_model_id TEXT,                        -- Pi: Bambu printer model code (N1, N2S, P1P, X1)
    nozzle_diameter REAL,                         -- Pi: Nozzle size in millimeters
    layer_count INTEGER,                          -- Pi: Total number of layers
    curr_bed_type TEXT,                           -- Pi: Bed/plate type (e.g., "Textured PEI Plate")
    default_print_profile TEXT,                   -- Pi: Print profile used (e.g., "0.20mm Standard")
    object_count INTEGER DEFAULT 1,               -- Pi: Number of objects/instances in print file

    -- Thumbnail (cloud storage)
    thumbnail_r2_key TEXT,                        -- Cloud: Thumbnail image R2 key

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, name)
);

-- Indexes for print_files
CREATE INDEX idx_print_files_tenant_id ON print_files(tenant_id);
CREATE INDEX idx_print_files_product_id ON print_files(product_id);
CREATE INDEX idx_print_files_printer_model ON print_files(printer_model_id);
CREATE INDEX idx_print_files_filament_type ON print_files(filament_type);

-- ============================================================================
-- PRINT_FILE_VERSIONS TABLE
-- File versioning (supports up to 3 versions per file)
-- Source: Supabase print_file_versions table
-- ============================================================================
CREATE TABLE print_file_versions (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    print_file_id TEXT NOT NULL REFERENCES print_files(id) ON DELETE CASCADE,

    -- Version information
    version_number INTEGER NOT NULL               -- Version number (1-3)
        CHECK (version_number BETWEEN 1 AND 3),
    file_url TEXT,                                -- Legacy URL (deprecated)
    r2_key TEXT,                                  -- R2 object key for this version
    notes TEXT,                                   -- Version notes/changelog
    is_current_version INTEGER DEFAULT 0,         -- Boolean: this is the active version

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(print_file_id, version_number)
);

-- Indexes for print_file_versions
CREATE INDEX idx_print_file_versions_file_id ON print_file_versions(print_file_id);
CREATE INDEX idx_print_file_versions_current ON print_file_versions(print_file_id, is_current_version);

-- ============================================================================
-- PRINT_JOBS TABLE
-- Print queue and job history with all merged columns
-- Source: Pi SQLite PrintJob model + Supabase print_jobs table
-- ============================================================================
CREATE TABLE print_jobs (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Foreign keys
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,
    print_file_id TEXT NOT NULL REFERENCES print_files(id),
    product_sku_id TEXT REFERENCES product_skus(id) ON DELETE SET NULL,
    submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Job information (from both)
    file_name TEXT NOT NULL,                      -- Cached file name for display
    status TEXT DEFAULT 'queued'                  -- Job status (expanded from Pi SQLite)
        CHECK (status IN ('queued', 'processing', 'uploaded', 'printing', 'paused', 'completed', 'failed', 'cancelled')),
    color TEXT NOT NULL,                          -- Filament color for this job
    filament_type TEXT NOT NULL,                  -- Material type
    material_type TEXT NOT NULL,                  -- Material category

    -- Quantity (from both)
    number_of_units INTEGER NOT NULL DEFAULT 1,   -- Units being printed

    -- Print metrics (from both)
    filament_needed_grams INTEGER,                -- Filament needed (stored as integer, divide by 100 for decimals)
    estimated_print_time_minutes INTEGER,         -- Estimated duration
    actual_print_time_minutes INTEGER,            -- Actual duration after completion
    progress_percentage INTEGER DEFAULT 0,        -- Current progress (0-100)

    -- Pi SQLite: Printer tracking fields
    bambu_job_id TEXT,                            -- Pi: Bambu printer's job ID for tracking
    printer_numeric_id INTEGER,                   -- Pi: Simple printer ID for printer manager
    last_sync_time TEXT,                          -- Pi: Last time job was synced with printer

    -- Queue management (from both)
    priority INTEGER DEFAULT 0,                   -- Higher = more urgent
    failure_reason TEXT,                          -- Error message if failed

    -- Timestamps (from both)
    time_submitted TEXT DEFAULT (datetime('now')), -- When job was created
    time_started TEXT,                            -- When printing started
    time_completed TEXT,                          -- When job completed/failed

    -- Pi SQLite: SKU-related fields for workflow
    requires_assembly INTEGER DEFAULT 0,          -- Pi: Product needs assembly
    quantity_per_print INTEGER DEFAULT 1,         -- Pi: Units produced per print

    -- Pi SQLite: Denormalized fields for reporting/display
    product_id TEXT,                              -- Pi: FK to products table (cached)
    product_name TEXT,                            -- Pi: Denormalized product name
    sku_name TEXT,                                -- Pi: Denormalized SKU code
    printer_model TEXT,                           -- Pi: Denormalized printer model
    printer_name TEXT,                            -- Pi: Denormalized printer name

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for print_jobs
CREATE INDEX idx_print_jobs_tenant_id ON print_jobs(tenant_id);
CREATE INDEX idx_print_jobs_printer_id ON print_jobs(printer_id);
CREATE INDEX idx_print_jobs_print_file_id ON print_jobs(print_file_id);
CREATE INDEX idx_print_jobs_product_sku_id ON print_jobs(product_sku_id);
CREATE INDEX idx_print_jobs_status ON print_jobs(status);
CREATE INDEX idx_print_jobs_priority ON print_jobs(priority);
CREATE INDEX idx_print_jobs_submitted ON print_jobs(time_submitted);
CREATE INDEX idx_print_jobs_tenant_status ON print_jobs(tenant_id, status);
CREATE INDEX idx_print_jobs_bambu_job ON print_jobs(bambu_job_id);

-- Add foreign key from products to print_files (deferred to avoid circular dependency)
-- This is handled by the FK in products table pointing to print_file_id
