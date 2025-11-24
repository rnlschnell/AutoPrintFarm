-- Migration 0009: Product Templates
-- Product template definitions for standardized product configurations
-- Source: Supabase product_templates table

-- ============================================================================
-- PRODUCT_TEMPLATES TABLE
-- Templates for creating products with predefined settings
-- Source: Supabase product_templates table
-- ============================================================================
CREATE TABLE product_templates (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Template information
    name TEXT NOT NULL,                           -- Template name
    description TEXT,                             -- Template description
    category TEXT,                                -- Product category

    -- Production metrics
    print_time_minutes INTEGER NOT NULL,          -- Estimated print time in minutes
    material_usage_grams INTEGER NOT NULL,        -- Material usage in grams (stored as integer, multiply by 100)

    -- Pricing (stored as cents to avoid float issues)
    production_cost INTEGER NOT NULL,             -- Production cost in cents
    base_selling_price INTEGER NOT NULL,          -- Base selling price in cents

    -- Additional details
    specifications TEXT,                          -- JSON string with specifications
    image_url TEXT,                               -- Template image URL

    -- Status
    is_active INTEGER DEFAULT 1,                  -- Boolean: template is active

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, name)
);

-- Indexes for product_templates
CREATE INDEX idx_product_templates_tenant_id ON product_templates(tenant_id);
CREATE INDEX idx_product_templates_category ON product_templates(category);
CREATE INDEX idx_product_templates_is_active ON product_templates(is_active);
