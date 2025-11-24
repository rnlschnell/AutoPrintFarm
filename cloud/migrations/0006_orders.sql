-- Migration 0006: Orders
-- Order management tables
-- Source: Supabase orders/order_items tables

-- ============================================================================
-- ORDERS TABLE
-- Customer orders from various platforms
-- Source: Supabase orders table
-- ============================================================================
CREATE TABLE orders (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Order identification
    order_number TEXT NOT NULL,                   -- Platform order number
    platform TEXT NOT NULL                        -- Source platform
        CHECK (platform IN ('shopify', 'amazon', 'etsy', 'manual', 'other')),

    -- Customer information
    customer_name TEXT NOT NULL,                  -- Customer full name
    customer_email TEXT,                          -- Customer email address
    customer_phone TEXT,                          -- Customer phone number

    -- Order details
    order_date TEXT NOT NULL,                     -- When order was placed (ISO8601)
    status TEXT DEFAULT 'pending'                 -- Order status
        CHECK (status IN ('pending', 'processing', 'printed', 'assembled', 'shipped', 'fulfilled', 'cancelled', 'refunded')),

    -- Financials (stored as cents)
    total_revenue INTEGER NOT NULL,               -- Total order value in cents
    shipping_cost INTEGER DEFAULT 0,              -- Shipping cost in cents
    tax_amount INTEGER DEFAULT 0,                 -- Tax amount in cents
    discount_amount INTEGER DEFAULT 0,            -- Discount in cents

    -- Shipping address
    shipping_street TEXT,                         -- Street address
    shipping_city TEXT,                           -- City
    shipping_state TEXT,                          -- State/province
    shipping_zip TEXT,                            -- Postal code
    shipping_country TEXT DEFAULT 'USA',          -- Country

    -- Fulfillment tracking
    tracking_number TEXT,                         -- Shipping tracking number
    tracking_url TEXT,                            -- Tracking URL
    shipped_at TEXT,                              -- When order was shipped

    -- Platform-specific data
    external_id TEXT,                             -- ID in external platform (Shopify, etc.)
    external_data TEXT,                           -- JSON string with platform-specific data

    -- Notes
    notes TEXT,                                   -- Internal notes

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    -- Unique constraint
    UNIQUE(tenant_id, order_number)
);

-- Indexes for orders
CREATE INDEX idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_platform ON orders(platform);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer_email ON orders(customer_email);
CREATE INDEX idx_orders_order_date ON orders(order_date);
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX idx_orders_external_id ON orders(external_id);

-- ============================================================================
-- ORDER_ITEMS TABLE
-- Line items within an order
-- Source: Supabase order_items table
-- ============================================================================
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    -- Product reference
    finished_good_id TEXT REFERENCES finished_goods(id) ON DELETE SET NULL,
    product_sku_id TEXT REFERENCES product_skus(id) ON DELETE SET NULL,

    -- Item information (denormalized for historical record)
    sku TEXT NOT NULL,                            -- SKU code at time of order
    product_name TEXT NOT NULL,                   -- Product name at time of order

    -- Quantity and pricing (prices in cents)
    quantity INTEGER NOT NULL,                    -- Quantity ordered
    unit_price INTEGER NOT NULL,                  -- Price per unit in cents
    total_price INTEGER NOT NULL,                 -- Line total in cents

    -- Fulfillment
    quantity_fulfilled INTEGER DEFAULT 0,         -- How many have been fulfilled
    fulfillment_status TEXT DEFAULT 'pending'     -- Item fulfillment status
        CHECK (fulfillment_status IN ('pending', 'partial', 'fulfilled', 'cancelled')),

    -- Notes
    notes TEXT,                                   -- Item-specific notes

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for order_items
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_finished_good_id ON order_items(finished_good_id);
CREATE INDEX idx_order_items_product_sku_id ON order_items(product_sku_id);
CREATE INDEX idx_order_items_sku ON order_items(sku);
CREATE INDEX idx_order_items_fulfillment_status ON order_items(fulfillment_status);
