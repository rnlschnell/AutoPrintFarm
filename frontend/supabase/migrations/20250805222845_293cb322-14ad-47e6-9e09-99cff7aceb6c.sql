-- Populate order_items table with sample data for existing orders
INSERT INTO public.order_items (tenant_id, order_id, product_name, sku, quantity, unit_price, total_price)
SELECT 
  o.tenant_id,
  o.id as order_id,
  CASE 
    WHEN o.platform = 'Shopify' THEN 'Wireless Phone Charger'
    WHEN o.platform = 'Etsy' THEN 'Custom Phone Stand'
    ELSE 'Phone Accessory'
  END as product_name,
  CASE 
    WHEN o.platform = 'Shopify' THEN 'WPC-001-BLK'
    WHEN o.platform = 'Etsy' THEN 'CPS-002-WHT'
    ELSE 'PA-003-BLU'
  END as sku,
  1 as quantity,
  COALESCE(o.subtotal, 25.00) as unit_price,
  COALESCE(o.subtotal, 25.00) as total_price
FROM public.orders o
WHERE NOT EXISTS (
  SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
);