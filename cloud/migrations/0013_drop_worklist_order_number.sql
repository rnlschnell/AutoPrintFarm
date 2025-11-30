-- ============================================================================
-- Migration: Drop order_number from worklist_tasks
-- Description: Remove unused order_number field from worklist_tasks table
-- ============================================================================

-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
-- Step 1: Create new table without order_number
CREATE TABLE worklist_tasks_new (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assembly_task_id TEXT REFERENCES assembly_tasks(id) ON DELETE SET NULL,
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    task_type TEXT NOT NULL
        CHECK (task_type IN ('assembly', 'filament_change', 'collection', 'maintenance', 'quality_check')),
    priority TEXT DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    estimated_time_minutes INTEGER,
    actual_time_minutes INTEGER,
    started_at TEXT,
    completed_at TEXT,
    due_date TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Step 2: Copy data from old table (excluding order_number)
INSERT INTO worklist_tasks_new (
    id, tenant_id, assembly_task_id, printer_id, assigned_to,
    title, subtitle, description, task_type, priority, status,
    estimated_time_minutes, actual_time_minutes, started_at, completed_at,
    due_date, metadata, created_at, updated_at
)
SELECT
    id, tenant_id, assembly_task_id, printer_id, assigned_to,
    title, subtitle, description, task_type, priority, status,
    estimated_time_minutes, actual_time_minutes, started_at, completed_at,
    due_date, metadata, created_at, updated_at
FROM worklist_tasks;

-- Step 3: Drop old table
DROP TABLE worklist_tasks;

-- Step 4: Rename new table
ALTER TABLE worklist_tasks_new RENAME TO worklist_tasks;

-- Step 5: Recreate indexes
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
