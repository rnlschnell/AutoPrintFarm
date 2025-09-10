-- Reactivate the deactivated SKUs for "test produ" product
UPDATE product_skus 
SET is_active = true 
WHERE product_id = '566e5d3d-4007-4996-944a-0ba78c60a0c2'
AND is_active = false;