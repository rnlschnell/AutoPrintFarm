-- Migration 0001: Tenants and Users
-- Core authentication and multi-tenancy tables
-- Merged from: Supabase profiles/tenants + Cloud architecture requirements

-- ============================================================================
-- TENANTS TABLE
-- Organizations/companies using the platform
-- Source: Supabase tenants table
-- ============================================================================
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    subdomain TEXT UNIQUE NOT NULL,               -- Unique subdomain identifier
    company_name TEXT NOT NULL,                   -- Display name
    is_active INTEGER DEFAULT 1,                  -- Boolean: 1=active, 0=inactive
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for tenants
CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX idx_tenants_is_active ON tenants(is_active);

-- ============================================================================
-- USERS TABLE
-- User accounts (adapted from Supabase profiles)
-- Source: Supabase profiles table
-- ============================================================================
CREATE TABLE users (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    email TEXT UNIQUE NOT NULL,                   -- User email address
    full_name TEXT NOT NULL,                      -- Display name
    password_hash TEXT,                           -- Hashed password (for self-hosted auth)
    is_active INTEGER DEFAULT 1,                  -- Boolean: 1=active, 0=inactive
    last_login TEXT,                              -- ISO8601 timestamp of last login
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now'))     -- ISO8601 timestamp
);

-- Indexes for users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);

-- ============================================================================
-- TENANT_MEMBERS TABLE
-- User-tenant membership with roles (many-to-many)
-- Source: Cloud architecture requirement for multi-tenancy
-- ============================================================================
CREATE TABLE tenant_members (
    id TEXT PRIMARY KEY,                          -- UUID as TEXT (36 chars)
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'operator'         -- 'owner', 'admin', 'operator', 'viewer'
        CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
    invited_by TEXT REFERENCES users(id),         -- Who invited this user
    invited_at TEXT,                              -- When invitation was sent
    accepted_at TEXT,                             -- When user accepted
    is_active INTEGER DEFAULT 1,                  -- Boolean: 1=active, 0=inactive
    created_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp
    updated_at TEXT DEFAULT (datetime('now')),    -- ISO8601 timestamp

    UNIQUE(tenant_id, user_id)                    -- One membership per user per tenant
);

-- Indexes for tenant_members
CREATE INDEX idx_tenant_members_tenant_id ON tenant_members(tenant_id);
CREATE INDEX idx_tenant_members_user_id ON tenant_members(user_id);
CREATE INDEX idx_tenant_members_role ON tenant_members(role);
CREATE INDEX idx_tenant_members_tenant_user ON tenant_members(tenant_id, user_id);
