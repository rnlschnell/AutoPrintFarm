-- Migration 0003: Products and Inventory Presets
-- Product catalog, SKUs, and configuration presets
-- Merged from: Pi SQLite + Supabase products/product_skus/color_presets

-- ============================================================================
-- PRODUCTS TABLE
-- Product catalog with all merged columns
-- Source: Pi SQLite Product model + Supabase products table
-- ============================================================================
CREATE TABLE products (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Basic product information (from both)
    name TEXT NOT NULL,                           -- Product name
    description TEXT,                             -- Product description
    category TEXT,                                -- Product category

    -- File association (from Pi SQLite)
    print_file_id TEXT,                           -- FK to print_files (set after print_files created)
    file_name TEXT,                               -- Pi: Cached file name

    -- Assembly/processing flags (merged)
    requires_assembly INTEGER DEFAULT 0,          -- From both: needs post-print assembly
    requires_post_processing INTEGER DEFAULT 0,   -- Pi: needs post-processing

    -- Printer configuration (from Pi SQLite)
    printer_priority TEXT,                        -- Pi: JSON array of preferred printer IDs

    -- Display (from both)
    image_url TEXT,                               -- Product image URL (R2 path)
    is_active INTEGER DEFAULT 1,                  -- Boolean: product is active

    -- Wiki link (from Pi SQLite)
    wiki_id TEXT,                                 -- Pi: Link to wiki articles

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraints
    UNIQUE(tenant_id, name)
);

-- Indexes for products
CREATE INDEX idx_products_tenant_id ON products(tenant_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_print_file ON products(print_file_id);

-- ============================================================================
-- PRODUCT_SKUS TABLE
-- Product variants (color/material combinations)
-- Source: Pi SQLite ProductSku model + Supabase product_skus table
-- ============================================================================
CREATE TABLE product_skus (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- SKU identification
    sku TEXT NOT NULL,                            -- SKU code (e.g., "BAGCLIP-RED-001")
    color TEXT NOT NULL,                          -- Color name
    filament_type TEXT,                           -- Pi: Material type (PLA, PETG, etc.)
    hex_code TEXT,                                -- Pi: Color hex code

    -- Quantity and pricing
    quantity INTEGER NOT NULL DEFAULT 1,          -- Units per print
    stock_level INTEGER NOT NULL DEFAULT 0,       -- Current stock level
    price INTEGER,                                -- Price in cents (avoid float issues)
    low_stock_threshold INTEGER DEFAULT 0,        -- Pi: Alert threshold

    -- Status
    is_active INTEGER DEFAULT 1,                  -- Boolean: SKU is active

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for product_skus
CREATE INDEX idx_product_skus_tenant_id ON product_skus(tenant_id);
CREATE INDEX idx_product_skus_product_id ON product_skus(product_id);
CREATE INDEX idx_product_skus_tenant_product ON product_skus(tenant_id, product_id);
CREATE INDEX idx_product_skus_sku ON product_skus(sku);
CREATE INDEX idx_product_skus_color ON product_skus(color);

-- ============================================================================
-- PRODUCT_COMPONENTS TABLE
-- Components required to build a product (for assembly tracking)
-- Source: Supabase product_components table
-- ============================================================================
CREATE TABLE product_components (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,

    -- Component information
    component_name TEXT NOT NULL,                 -- Name of the component
    component_type TEXT,                          -- Type/category of component
    quantity_required INTEGER NOT NULL DEFAULT 1, -- How many needed per product
    notes TEXT,                                   -- Assembly notes

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for product_components
CREATE INDEX idx_product_components_product_id ON product_components(product_id);

-- ============================================================================
-- COLOR_PRESETS TABLE
-- Global filament color presets per tenant
-- Source: Pi SQLite ColorPreset model + Supabase color_presets table
-- ============================================================================
CREATE TABLE color_presets (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Color information
    color_name TEXT NOT NULL,                     -- Display name (e.g., "Galaxy Black")
    hex_code TEXT NOT NULL,                       -- Hex color code (e.g., "#1a1a2e")
    filament_type TEXT NOT NULL,                  -- Material type (PLA, PETG, ABS, etc.)

    -- Status
    is_active INTEGER DEFAULT 1,                  -- Boolean: preset is active

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, color_name, filament_type)
);

-- Indexes for color_presets
CREATE INDEX idx_color_presets_tenant_id ON color_presets(tenant_id);
CREATE INDEX idx_color_presets_filament_type ON color_presets(filament_type);
CREATE INDEX idx_color_presets_is_active ON color_presets(tenant_id, is_active);

-- ============================================================================
-- BUILD_PLATE_TYPES TABLE
-- Build plate type presets per tenant
-- Source: Pi SQLite BuildPlateType model
-- ============================================================================
CREATE TABLE build_plate_types (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Plate information
    name TEXT NOT NULL,                           -- Display name (e.g., "Textured PEI")
    description TEXT,                             -- Description/notes

    -- Status
    is_active INTEGER DEFAULT 1,                  -- Boolean: preset is active

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, name)
);

-- Indexes for build_plate_types
CREATE INDEX idx_build_plate_types_tenant_id ON build_plate_types(tenant_id);
CREATE INDEX idx_build_plate_types_is_active ON build_plate_types(tenant_id, is_active);
