-- Seed data for local development/testing
-- This creates a test tenant and a hub ready for ESP32 connection

-- Create test tenant
INSERT OR REPLACE INTO tenants (id, subdomain, company_name, is_active, created_at, updated_at)
VALUES (
    'test-tenant-001',
    'testfarm',
    'Test Print Farm',
    1,
    datetime('now'),
    datetime('now')
);

-- Create test user
INSERT OR REPLACE INTO users (id, email, full_name, is_active, created_at, updated_at)
VALUES (
    'test-user-001',
    'test@example.com',
    'Test User',
    1,
    datetime('now'),
    datetime('now')
);

-- Add user to tenant
INSERT OR REPLACE INTO tenant_members (id, tenant_id, user_id, role, is_active, created_at, updated_at)
VALUES (
    'test-member-001',
    'test-tenant-001',
    'test-user-001',
    'owner',
    1,
    datetime('now'),
    datetime('now')
);

-- Create a wildcard hub entry that will match any ESP32 hub ID
-- The ESP32 generates hub IDs like HUB-AABBCCDDEEFF from its MAC address
-- For testing, we'll use a placeholder - you'll need to update this with your actual hub ID
-- after seeing it in the ESP32 serial output
INSERT OR REPLACE INTO hubs (id, tenant_id, name, secret_hash, is_online, created_at, updated_at, claimed_at)
VALUES (
    'HUB-PLACEHOLDER',
    'test-tenant-001',
    'Development Hub',
    'test-secret-hash',  -- Not verified in development mode
    0,
    datetime('now'),
    datetime('now'),
    datetime('now')
);

-- Note: After flashing the ESP32, look at serial output for the actual hub ID
-- Then run: UPDATE hubs SET id = 'HUB-ACTUAL-MAC-HERE' WHERE id = 'HUB-PLACEHOLDER';
