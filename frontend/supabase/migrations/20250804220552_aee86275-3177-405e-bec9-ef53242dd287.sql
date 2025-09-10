-- Fix the stock synchronization issue and ensure proper finished_goods creation

-- First, sync existing records where stock levels don't match
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

-- Ensure auto_create_finished_good trigger sets the correct initial stock
CREATE OR REPLACE FUNCTION public.auto_create_finished_good()
RETURNS TRIGGER AS $$
BEGIN
  -- Create finished_goods entry for the new product_sku
  INSERT INTO public.finished_goods (
    tenant_id,
    product_sku_id,
    sku,
    color,
    material,
    current_stock,
    assembly_status,
    unit_price,
    status
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    NEW.sku,
    NEW.color,
    COALESCE(NEW.filament_type, 'PLA'), -- Use filament_type as material
    NEW.stock_level, -- Use the stock_level from the SKU
    'printed',
    NEW.price,
    CASE 
      WHEN NEW.stock_level <= 0 THEN 'out_of_stock'
      WHEN NEW.stock_level <= 5 THEN 'low_stock'
      ELSE 'in_stock'
    END
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;