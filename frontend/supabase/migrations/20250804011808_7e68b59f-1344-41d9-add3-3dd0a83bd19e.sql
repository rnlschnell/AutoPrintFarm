-- Create trigger to sync stock_level in product_skus when finished_goods.current_stock changes
CREATE OR REPLACE FUNCTION public.sync_stock_level_to_product_skus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- When finished_goods.current_stock is updated, sync to product_skus.stock_level
  IF NEW.current_stock != OLD.current_stock AND NEW.product_sku_id IS NOT NULL THEN
    UPDATE product_skus 
    SET 
      stock_level = NEW.current_stock,
      updated_at = now()
    WHERE id = NEW.product_sku_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS sync_stock_level_trigger ON public.finished_goods;
CREATE TRIGGER sync_stock_level_trigger
  AFTER UPDATE ON public.finished_goods
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_stock_level_to_product_skus();

-- Also sync existing data to ensure consistency
UPDATE product_skus 
SET stock_level = fg.current_stock
FROM finished_goods fg 
WHERE product_skus.id = fg.product_sku_id 
AND product_skus.stock_level != fg.current_stock;