-- Clean up duplicate "test produ" product
-- Keep the older one (566e5d3d-4007-4996-944a-0ba78c60a0c2) and remove the newer duplicate

DELETE FROM products 
WHERE id = 'ef708bde-9b25-474c-b0b5-2e91475eb223' 
AND name = 'test produ';