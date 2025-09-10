-- Create trigger to sync stock_level changes from product_skus to finished_goods
CREATE OR REPLACE FUNCTION sync_sku_stock_to_finished_goods()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When stock_level is updated in product_skus, sync to finished_goods
  IF NEW.stock_level != OLD.stock_level THEN
    UPDATE finished_goods 
    SET 
      current_stock = NEW.stock_level,
      status = CASE 
        WHEN NEW.stock_level <= 0 THEN 'out_of_stock'
        WHEN NEW.stock_level <= 5 THEN 'low_stock'
        ELSE 'in_stock'
      END,
      updated_at = now()
    WHERE product_sku_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS sync_sku_stock_trigger ON product_skus;
CREATE TRIGGER sync_sku_stock_trigger
  AFTER UPDATE ON product_skus
  FOR EACH ROW
  EXECUTE FUNCTION sync_sku_stock_to_finished_goods();

-- Fix the existing newsku stock discrepancy
UPDATE finished_goods 
SET 
  current_stock = 5,
  status = 'in_stock',
  updated_at = now()
WHERE product_sku_id = 'f7fc4fe7-e04d-4444-b5dd-73fc41b53a32';