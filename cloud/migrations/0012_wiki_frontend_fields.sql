-- Migration 0012: Add frontend wiki fields to wiki_articles
-- Adds fields needed by the frontend Wiki interface:
-- description, estimated_time_minutes, difficulty, tools_required, sections, sku_id

-- Add description field (maps to excerpt in existing schema, but keeping both for flexibility)
ALTER TABLE wiki_articles ADD COLUMN description TEXT;

-- Add estimated time in minutes
ALTER TABLE wiki_articles ADD COLUMN estimated_time_minutes INTEGER;

-- Add difficulty level (easy, medium, hard)
ALTER TABLE wiki_articles ADD COLUMN difficulty TEXT;

-- Add tools required (JSON array of strings)
ALTER TABLE wiki_articles ADD COLUMN tools_required TEXT;

-- Add sections (JSON array of WikiSection objects)
ALTER TABLE wiki_articles ADD COLUMN sections TEXT DEFAULT '[]';

-- Add SKU reference for SKU-specific wikis
ALTER TABLE wiki_articles ADD COLUMN sku_id TEXT REFERENCES product_skus(id) ON DELETE SET NULL;

-- Add index for sku_id lookups
CREATE INDEX idx_wiki_articles_sku_id ON wiki_articles(sku_id);
