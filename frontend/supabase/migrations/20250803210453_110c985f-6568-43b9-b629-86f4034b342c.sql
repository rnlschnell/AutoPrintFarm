-- Sync stock levels from product_skus.stock_level to finished_goods.current_stock
UPDATE finished_goods 
SET current_stock = ps.stock_level,
    status = CASE 
        WHEN ps.stock_level = 0 THEN 'out_of_stock'
        WHEN ps.stock_level < 5 THEN 'low_stock'
        ELSE 'in_stock'
    END
FROM product_skus ps
WHERE finished_goods.product_sku_id = ps.id;