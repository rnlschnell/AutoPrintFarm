-- Fix specific SKUs that were accidentally deactivated for "test produ" product
-- Using direct tenant_id instead of function to avoid any RLS issues
UPDATE public.product_skus 
SET is_active = true, updated_at = now()
WHERE product_id = '566e5d3d-4007-4996-944a-0ba78c60a0c2' 
AND is_active = false;

-- Reactivate corresponding finished goods entries for these SKUs
UPDATE public.finished_goods 
SET is_active = true, updated_at = now()
WHERE product_sku_id IN (
  SELECT id FROM product_skus 
  WHERE product_id = '566e5d3d-4007-4996-944a-0ba78c60a0c2'
) AND is_active = false;