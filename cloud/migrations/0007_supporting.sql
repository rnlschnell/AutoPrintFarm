-- Migration 0007: Supporting Features
-- Wiki, cameras, and automation tables
-- Source: Cloud architecture (PRINTFARM_CLOUD_ARCHITECTURE.md)

-- ============================================================================
-- WIKI_ARTICLES TABLE
-- Internal documentation/knowledge base
-- Source: Cloud architecture requirement
-- ============================================================================
CREATE TABLE wiki_articles (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Article content
    title TEXT NOT NULL,                          -- Article title
    slug TEXT NOT NULL,                           -- URL-friendly slug
    content TEXT,                                 -- Markdown content
    excerpt TEXT,                                 -- Short description/summary

    -- Organization
    category TEXT,                                -- Article category
    tags TEXT,                                    -- JSON array of tags

    -- Authorship
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Product link (for product-specific documentation)
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,

    -- Publishing
    is_published INTEGER DEFAULT 0,               -- Boolean: article is published
    published_at TEXT,                            -- When article was published

    -- SEO/Display
    meta_title TEXT,                              -- SEO title
    meta_description TEXT,                        -- SEO description
    featured_image_url TEXT,                      -- Featured image

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, slug)
);

-- Indexes for wiki_articles
CREATE INDEX idx_wiki_articles_tenant_id ON wiki_articles(tenant_id);
CREATE INDEX idx_wiki_articles_slug ON wiki_articles(tenant_id, slug);
CREATE INDEX idx_wiki_articles_category ON wiki_articles(category);
CREATE INDEX idx_wiki_articles_product_id ON wiki_articles(product_id);
CREATE INDEX idx_wiki_articles_is_published ON wiki_articles(is_published);
CREATE INDEX idx_wiki_articles_author ON wiki_articles(author_id);

-- ============================================================================
-- CAMERAS TABLE
-- Camera feed configurations
-- Source: Cloud architecture requirement
-- ============================================================================
CREATE TABLE cameras (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Camera identification
    name TEXT NOT NULL,                           -- Display name
    description TEXT,                             -- Description/notes

    -- Association
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,  -- Associated printer
    hub_id TEXT REFERENCES hubs(id) ON DELETE SET NULL,          -- Hub managing camera

    -- Camera type
    camera_type TEXT NOT NULL DEFAULT 'ip'        -- Type of camera
        CHECK (camera_type IN ('bambu', 'ip', 'usb', 'rtsp', 'mjpeg')),

    -- Connection details
    stream_url TEXT,                              -- Stream URL (for IP/RTSP cameras)
    snapshot_url TEXT,                            -- Snapshot URL
    ip_address TEXT,                              -- Camera IP address
    port INTEGER,                                 -- Camera port
    username TEXT,                                -- Auth username (encrypted)
    password TEXT,                                -- Auth password (encrypted)

    -- Bambu-specific
    serial_number TEXT,                           -- For Bambu printer cameras

    -- Status
    is_active INTEGER DEFAULT 1,                  -- Boolean: camera is enabled
    is_online INTEGER DEFAULT 0,                  -- Boolean: camera is reachable
    last_snapshot_at TEXT,                        -- Last snapshot timestamp
    last_error TEXT,                              -- Last error message

    -- Display settings
    rotation INTEGER DEFAULT 0,                   -- Rotation in degrees (0, 90, 180, 270)
    flip_horizontal INTEGER DEFAULT 0,            -- Boolean: flip horizontally
    flip_vertical INTEGER DEFAULT 0,              -- Boolean: flip vertically

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for cameras
CREATE INDEX idx_cameras_tenant_id ON cameras(tenant_id);
CREATE INDEX idx_cameras_printer_id ON cameras(printer_id);
CREATE INDEX idx_cameras_hub_id ON cameras(hub_id);
CREATE INDEX idx_cameras_is_active ON cameras(is_active);
CREATE INDEX idx_cameras_camera_type ON cameras(camera_type);

-- ============================================================================
-- AUTOMATION_RULES TABLE
-- Event-driven automation configuration
-- Source: Cloud architecture requirement
-- ============================================================================
CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Rule identification
    name TEXT NOT NULL,                           -- Rule name
    description TEXT,                             -- Rule description

    -- Trigger configuration
    trigger_type TEXT NOT NULL                    -- What triggers this rule
        CHECK (trigger_type IN (
            'print_completed', 'print_failed', 'print_started',
            'printer_offline', 'printer_online', 'printer_error',
            'low_stock', 'order_received', 'order_fulfilled',
            'assembly_completed', 'task_completed',
            'hub_offline', 'hub_online',
            'schedule'                            -- Time-based trigger
        )),
    trigger_conditions TEXT,                      -- JSON: Additional conditions

    -- Action configuration
    action_type TEXT NOT NULL                     -- What action to take
        CHECK (action_type IN (
            'send_notification', 'send_email', 'send_webhook',
            'create_task', 'update_status', 'assign_printer',
            'start_next_job', 'pause_queue', 'resume_queue',
            'update_inventory', 'create_order_item',
            'run_script'                          -- Custom script execution
        )),
    action_config TEXT,                           -- JSON: Action parameters

    -- Targeting
    printer_ids TEXT,                             -- JSON array: specific printers (null = all)
    product_ids TEXT,                             -- JSON array: specific products (null = all)

    -- Schedule (for schedule trigger_type)
    schedule_cron TEXT,                           -- Cron expression
    schedule_timezone TEXT DEFAULT 'UTC',         -- Timezone for schedule

    -- Status
    is_enabled INTEGER DEFAULT 1,                 -- Boolean: rule is active
    last_triggered_at TEXT,                       -- Last execution timestamp
    trigger_count INTEGER DEFAULT 0,              -- How many times triggered

    -- Rate limiting
    cooldown_seconds INTEGER DEFAULT 0,           -- Minimum seconds between triggers
    max_triggers_per_hour INTEGER,                -- Maximum triggers per hour

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for automation_rules
CREATE INDEX idx_automation_rules_tenant_id ON automation_rules(tenant_id);
CREATE INDEX idx_automation_rules_trigger_type ON automation_rules(trigger_type);
CREATE INDEX idx_automation_rules_is_enabled ON automation_rules(is_enabled);
CREATE INDEX idx_automation_rules_tenant_enabled ON automation_rules(tenant_id, is_enabled);
