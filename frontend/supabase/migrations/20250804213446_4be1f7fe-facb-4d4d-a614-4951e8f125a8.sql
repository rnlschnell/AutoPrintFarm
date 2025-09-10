-- Fix the finished_goods unique constraint to only apply to active records
ALTER TABLE finished_goods DROP CONSTRAINT finished_goods_tenant_id_sku_key;

-- Create a new partial unique constraint that only applies to active finished goods
CREATE UNIQUE INDEX unique_active_finished_goods_sku_per_tenant 
ON finished_goods (tenant_id, sku) 
WHERE is_active = true;