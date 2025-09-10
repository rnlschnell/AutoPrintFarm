-- Clean up finished_goods records that correspond to inactive product_skus
UPDATE finished_goods 
SET is_active = false 
WHERE product_sku_id IN (
  SELECT id FROM product_skus WHERE is_active = false
) AND is_active = true;