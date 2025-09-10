-- Check current triggers and create missing ones
-- First, let's see what triggers currently exist
SELECT 
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers 
WHERE trigger_schema = 'public' 
AND event_object_table IN ('product_skus', 'finished_goods')
ORDER BY event_object_table, trigger_name;

-- Create the triggers if they don't exist
CREATE TRIGGER IF NOT EXISTS trigger_auto_create_finished_good
  AFTER INSERT ON public.product_skus
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_finished_good();

CREATE TRIGGER IF NOT EXISTS trigger_sync_sku_stock_to_finished_goods
  AFTER UPDATE OF stock_level ON public.product_skus
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sku_stock_to_finished_goods();

CREATE TRIGGER IF NOT EXISTS trigger_sync_stock_level_to_product_skus
  AFTER UPDATE OF current_stock ON public.finished_goods
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_stock_level_to_product_skus();

-- Fix the existing data issue - sync current stock_level to finished_goods
UPDATE finished_goods 
SET 
  current_stock = (
    SELECT stock_level 
    FROM product_skus 
    WHERE product_skus.id = finished_goods.product_sku_id
  ),
  status = CASE 
    WHEN (SELECT stock_level FROM product_skus WHERE product_skus.id = finished_goods.product_sku_id) <= 0 THEN 'out_of_stock'
    WHEN (SELECT stock_level FROM product_skus WHERE product_skus.id = finished_goods.product_sku_id) <= 5 THEN 'low_stock'
    ELSE 'in_stock'
  END,
  updated_at = now()
WHERE product_sku_id IS NOT NULL
AND current_stock != (SELECT stock_level FROM product_skus WHERE product_skus.id = finished_goods.product_sku_id);