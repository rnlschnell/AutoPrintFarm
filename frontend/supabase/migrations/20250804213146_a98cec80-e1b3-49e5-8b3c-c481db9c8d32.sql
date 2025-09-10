-- Drop the existing unique constraint
ALTER TABLE product_skus DROP CONSTRAINT unique_sku_per_tenant;

-- Create a new partial unique constraint that only applies to active SKUs
CREATE UNIQUE INDEX unique_active_sku_per_tenant 
ON product_skus (sku, tenant_id) 
WHERE is_active = true;