-- Migration: Dead Letter Queue Table
-- Phase 15: Background Queues
--
-- Stores failed queue messages for debugging and manual retry

CREATE TABLE IF NOT EXISTS dead_letter_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  original_queue TEXT NOT NULL,
  original_message TEXT NOT NULL,  -- JSON-serialized original message
  error_message TEXT,
  stack_trace TEXT,
  attempts INTEGER DEFAULT 0,
  failed_at TEXT NOT NULL,
  retried_at TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,

  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Index for listing by tenant
CREATE INDEX IF NOT EXISTS idx_dlm_tenant ON dead_letter_messages(tenant_id);

-- Index for filtering by queue
CREATE INDEX IF NOT EXISTS idx_dlm_queue ON dead_letter_messages(original_queue);

-- Index for ordering by failure time
CREATE INDEX IF NOT EXISTS idx_dlm_failed_at ON dead_letter_messages(failed_at DESC);
