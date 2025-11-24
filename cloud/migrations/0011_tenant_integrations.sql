-- Migration 0011: Tenant Integrations
-- External platform integration management
-- Phase 10: Orders & Shopify Integration

-- ============================================================================
-- TENANT_INTEGRATIONS TABLE
-- Stores credentials and settings for external platform integrations
-- ============================================================================
CREATE TABLE tenant_integrations (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Platform identification
    platform TEXT NOT NULL                        -- Integration platform
        CHECK (platform IN ('shopify', 'amazon', 'etsy', 'woocommerce', 'other')),

    -- Encrypted credentials (JSON encrypted with AES-256-GCM)
    credentials_encrypted TEXT NOT NULL,          -- Encrypted JSON with API keys, tokens, etc.

    -- Status flags
    is_enabled INTEGER DEFAULT 1,                 -- Whether integration is active
    sync_enabled INTEGER DEFAULT 1,               -- Whether auto-sync is enabled
    webhook_enabled INTEGER DEFAULT 0,            -- Whether webhooks are configured

    -- Sync tracking
    last_sync_at TEXT,                            -- Last successful sync (ISO8601)
    last_error TEXT,                              -- Last error message if any

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint - one integration per platform per tenant
    UNIQUE(tenant_id, platform)
);

-- Indexes for tenant_integrations
CREATE INDEX idx_tenant_integrations_tenant_id ON tenant_integrations(tenant_id);
CREATE INDEX idx_tenant_integrations_platform ON tenant_integrations(platform);
CREATE INDEX idx_tenant_integrations_enabled ON tenant_integrations(is_enabled);

-- ============================================================================
-- SHOPIFY_ORDERS_SYNC TABLE
-- Tracks which Shopify orders have been synced to prevent duplicates
-- ============================================================================
CREATE TABLE shopify_orders_sync (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Shopify identifiers
    shopify_order_id TEXT NOT NULL,               -- Shopify order ID (numeric as string)
    shopify_order_number TEXT NOT NULL,           -- Shopify order number (e.g., "#1001")

    -- Local reference
    local_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,

    -- Sync status
    sync_status TEXT DEFAULT 'synced'             -- Sync status
        CHECK (sync_status IN ('synced', 'pending', 'error', 'skipped')),
    sync_error TEXT,                              -- Error message if sync failed

    -- Timestamps
    shopify_created_at TEXT,                      -- When order was created in Shopify
    synced_at TEXT DEFAULT (datetime('now')),     -- When we synced it
    updated_at TEXT DEFAULT (datetime('now')),    -- Last update

    -- Unique constraint
    UNIQUE(tenant_id, shopify_order_id)
);

-- Indexes for shopify_orders_sync
CREATE INDEX idx_shopify_orders_sync_tenant ON shopify_orders_sync(tenant_id);
CREATE INDEX idx_shopify_orders_sync_shopify_id ON shopify_orders_sync(shopify_order_id);
CREATE INDEX idx_shopify_orders_sync_local_order ON shopify_orders_sync(local_order_id);
CREATE INDEX idx_shopify_orders_sync_status ON shopify_orders_sync(sync_status);
