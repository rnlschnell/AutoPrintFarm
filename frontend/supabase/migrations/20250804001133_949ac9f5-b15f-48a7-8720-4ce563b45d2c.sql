-- Fix the existing "newsku" stock level to 5 as intended
UPDATE product_skus 
SET stock_level = 5 
WHERE sku = 'newsku' 
AND stock_level = 0;