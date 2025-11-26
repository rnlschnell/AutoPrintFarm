-- Migration 0013: Hub Claim Token
-- Add hub_claim_token column to tenants for automatic hub claiming during BLE setup

-- ============================================================================
-- ADD HUB CLAIM TOKEN TO TENANTS
-- ============================================================================

-- Add column for hub claim token (used by ESP32 hubs to auto-claim during registration)
ALTER TABLE tenants ADD COLUMN hub_claim_token TEXT;

-- Index for efficient lookup during hub registration
CREATE INDEX idx_tenants_hub_claim_token ON tenants(hub_claim_token);
