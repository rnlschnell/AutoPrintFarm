-- Sync existing stock levels between product_skus and finished_goods
UPDATE finished_goods 
SET current_stock = ps.stock_level,
    status = CASE 
      WHEN ps.stock_level <= 0 THEN 'out_of_stock'
      WHEN ps.stock_level <= 5 THEN 'low_stock'
      ELSE 'in_stock'
    END,
    updated_at = now()
FROM product_skus ps 
WHERE finished_goods.product_sku_id = ps.id 
  AND finished_goods.current_stock != ps.stock_level;