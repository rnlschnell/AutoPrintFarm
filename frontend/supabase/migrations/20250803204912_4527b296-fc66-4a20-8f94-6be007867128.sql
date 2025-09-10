-- Ensure all existing product_skus have corresponding finished_goods entries
INSERT INTO finished_goods (
  tenant_id,
  product_sku_id,
  sku,
  color,
  material,
  current_stock,
  assembly_status,
  unit_price,
  status
)
SELECT 
  ps.tenant_id,
  ps.id,
  ps.sku,
  ps.color,
  'PLA',
  0,
  'printed',
  COALESCE(ps.price, 0),
  'out_of_stock'
FROM product_skus ps
LEFT JOIN finished_goods fg ON fg.product_sku_id = ps.id
WHERE fg.id IS NULL
  AND ps.is_active = true;