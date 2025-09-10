-- Remove color columns from non-filament inventory tables
ALTER TABLE packaging_inventory DROP COLUMN IF EXISTS color;
ALTER TABLE accessories_inventory DROP COLUMN IF EXISTS color;
ALTER TABLE printer_parts_inventory DROP COLUMN IF EXISTS color;