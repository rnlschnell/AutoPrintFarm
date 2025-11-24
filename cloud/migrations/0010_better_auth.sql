-- Migration 0010: Better Auth Tables
-- Adds tables required by Better Auth framework
-- Note: We already have a 'users' table, so we'll modify it and add the additional tables

-- ============================================================================
-- MODIFY USERS TABLE
-- Add columns required by Better Auth
-- ============================================================================

-- Add email_verified column (Better Auth requires this)
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;

-- Add avatar_url column for user profile images
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- ============================================================================
-- SESSIONS TABLE
-- Stores active user sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for sessions
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================================
-- ACCOUNTS TABLE
-- Stores OAuth provider accounts and credentials
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,                    -- 'credential', 'google', 'github', etc.
    account_id TEXT NOT NULL,                     -- Provider's user ID
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at TEXT,
    refresh_token_expires_at TEXT,
    scope TEXT,
    id_token TEXT,
    password TEXT,                                -- Hashed password for credential provider
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    UNIQUE(provider_id, account_id)
);

-- Indexes for accounts
CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_provider_account ON accounts(provider_id, account_id);

-- ============================================================================
-- VERIFICATIONS TABLE
-- Stores temporary verification tokens (email verification, password reset)
-- ============================================================================
CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,                     -- Email or other identifier
    value TEXT NOT NULL,                          -- Verification token/code
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for verifications
CREATE INDEX idx_verifications_identifier ON verifications(identifier);
CREATE INDEX idx_verifications_expires_at ON verifications(expires_at);
