-- Migration 0005: Finished Goods and Tasks
-- Inventory tracking and task management tables
-- Merged from: Pi SQLite FinishedGoods/AssemblyTask/WorklistTask models + Supabase tables

-- ============================================================================
-- FINISHED_GOODS TABLE
-- Completed inventory items (printed products ready for sale/assembly)
-- Source: Pi SQLite FinishedGoods model + Supabase finished_goods table
-- ============================================================================
CREATE TABLE finished_goods (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Foreign keys
    product_sku_id TEXT NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
    print_job_id TEXT REFERENCES print_jobs(id) ON DELETE SET NULL,

    -- Product information (denormalized for display)
    sku TEXT NOT NULL,                            -- SKU code
    color TEXT NOT NULL,                          -- Color name
    material TEXT NOT NULL,                       -- Material type

    -- Stock and quantity (merged)
    current_stock INTEGER NOT NULL DEFAULT 0,     -- Current stock level
    low_stock_threshold INTEGER DEFAULT 5,        -- Alert threshold
    quantity_per_sku INTEGER DEFAULT 1,           -- Units per SKU

    -- Pricing (stored as cents to avoid float issues)
    unit_price INTEGER NOT NULL DEFAULT 0,        -- Price per unit in cents
    extra_cost INTEGER DEFAULT 0,                 -- Additional costs in cents
    profit_margin INTEGER DEFAULT 0,              -- Margin percentage * 100

    -- Assembly tracking (from Pi SQLite)
    requires_assembly INTEGER DEFAULT 0,          -- Pi: Needs assembly
    quantity_assembled INTEGER DEFAULT 0,         -- Pi: How many have been assembled
    quantity_needs_assembly INTEGER DEFAULT 0,    -- Pi: How many still need assembly

    -- Status (merged - combines both schemas' status options)
    status TEXT DEFAULT 'active'                  -- Current status
        CHECK (status IN ('active', 'in_stock', 'low_stock', 'out_of_stock', 'needs_assembly', 'discontinued')),
    assembly_status TEXT DEFAULT 'printed'        -- Supabase: Assembly workflow status
        CHECK (assembly_status IN ('printed', 'needs_assembly', 'assembled')),

    -- Display
    image_url TEXT,                               -- Product image URL

    -- Management
    is_active INTEGER DEFAULT 1,                  -- Boolean: item is active

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for finished_goods
CREATE INDEX idx_finished_goods_tenant_id ON finished_goods(tenant_id);
CREATE INDEX idx_finished_goods_product_sku_id ON finished_goods(product_sku_id);
CREATE INDEX idx_finished_goods_print_job_id ON finished_goods(print_job_id);
CREATE INDEX idx_finished_goods_sku ON finished_goods(sku);
CREATE INDEX idx_finished_goods_status ON finished_goods(status);
CREATE INDEX idx_finished_goods_assembly_status ON finished_goods(assembly_status);
CREATE INDEX idx_finished_goods_low_stock ON finished_goods(tenant_id, current_stock, low_stock_threshold);

-- ============================================================================
-- ASSEMBLY_TASKS TABLE
-- Post-print assembly task tracking
-- Source: Pi SQLite AssemblyTask model + Supabase assembly_tasks table
-- ============================================================================
CREATE TABLE assembly_tasks (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Foreign keys
    finished_good_id TEXT NOT NULL REFERENCES finished_goods(id) ON DELETE CASCADE,
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Task information (from both)
    product_name TEXT NOT NULL,                   -- Product being assembled
    sku TEXT NOT NULL,                            -- SKU code
    quantity INTEGER NOT NULL DEFAULT 1,          -- Units to assemble

    -- Status
    status TEXT DEFAULT 'pending'                 -- Task status
        CHECK (status IN ('pending', 'in_progress', 'completed')),

    -- Notes
    notes TEXT,                                   -- Assembly instructions/notes

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    completed_at TEXT                             -- When task was completed
);

-- Indexes for assembly_tasks
CREATE INDEX idx_assembly_tasks_tenant_id ON assembly_tasks(tenant_id);
CREATE INDEX idx_assembly_tasks_finished_good_id ON assembly_tasks(finished_good_id);
CREATE INDEX idx_assembly_tasks_assigned_to ON assembly_tasks(assigned_to);
CREATE INDEX idx_assembly_tasks_status ON assembly_tasks(status);
CREATE INDEX idx_assembly_tasks_tenant_status ON assembly_tasks(tenant_id, status);

-- ============================================================================
-- WORKLIST_TASKS TABLE
-- General task management for all types of tasks
-- Source: Pi SQLite WorklistTask model + Supabase worklist_tasks table
-- ============================================================================
CREATE TABLE worklist_tasks (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Foreign keys (from both)
    assembly_task_id TEXT REFERENCES assembly_tasks(id) ON DELETE SET NULL,
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,  -- Pi: For printer-related tasks
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Task information (from both)
    title TEXT NOT NULL,                          -- Task title
    subtitle TEXT,                                -- Pi: Secondary title
    description TEXT,                             -- Task description

    -- Task type (from both)
    task_type TEXT NOT NULL                       -- Type of task
        CHECK (task_type IN ('assembly', 'filament_change', 'collection', 'maintenance', 'quality_check')),

    -- Priority and status (from both)
    priority TEXT DEFAULT 'medium'                -- Task priority
        CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT DEFAULT 'pending'                 -- Task status
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),

    -- Order reference (from Pi SQLite)
    order_number TEXT,                            -- Pi: Related order number

    -- Time tracking (from both)
    estimated_time_minutes INTEGER,               -- Estimated duration
    actual_time_minutes INTEGER,                  -- Actual duration
    started_at TEXT,                              -- When work started
    completed_at TEXT,                            -- When task completed
    due_date TEXT,                                -- Deadline

    -- Metadata (stored as JSON string for SQLite compatibility)
    metadata TEXT,                                -- JSON string with additional data

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for worklist_tasks
CREATE INDEX idx_worklist_tasks_tenant_id ON worklist_tasks(tenant_id);
CREATE INDEX idx_worklist_tasks_assembly_task_id ON worklist_tasks(assembly_task_id);
CREATE INDEX idx_worklist_tasks_printer_id ON worklist_tasks(printer_id);
CREATE INDEX idx_worklist_tasks_assigned_to ON worklist_tasks(assigned_to);
CREATE INDEX idx_worklist_tasks_status ON worklist_tasks(status);
CREATE INDEX idx_worklist_tasks_task_type ON worklist_tasks(task_type);
CREATE INDEX idx_worklist_tasks_priority ON worklist_tasks(priority);
CREATE INDEX idx_worklist_tasks_tenant_status ON worklist_tasks(tenant_id, status);
CREATE INDEX idx_worklist_tasks_tenant_type ON worklist_tasks(tenant_id, task_type);
CREATE INDEX idx_worklist_tasks_due_date ON worklist_tasks(due_date);
