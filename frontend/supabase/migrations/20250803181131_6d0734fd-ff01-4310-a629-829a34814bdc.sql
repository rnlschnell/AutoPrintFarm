-- Step 1: Clean up duplicate SKUs by keeping only the first one for each SKU
-- Delete duplicate entries keeping the one with the smallest ID
DELETE FROM product_skus ps1
WHERE ps1.id NOT IN (
  SELECT MIN(ps2.id)
  FROM product_skus ps2
  WHERE ps2.sku = ps1.sku
  AND ps2.tenant_id = ps1.tenant_id
  AND ps2.is_active = true
  GROUP BY ps2.sku, ps2.tenant_id
);

-- Step 2: Add unique constraint to prevent future duplicates
ALTER TABLE product_skus ADD CONSTRAINT unique_sku_per_tenant UNIQUE (sku, tenant_id);

-- Step 3: Create trigger function to auto-create finished_goods when product_skus are created
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
    'PLA', -- Default material, can be updated later
    0, -- Start with 0 stock
    'printed', -- Default status
    NEW.price,
    'out_of_stock'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to auto-create finished_goods for new product_skus
CREATE TRIGGER trigger_auto_create_finished_good
  AFTER INSERT ON public.product_skus
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_finished_good();

-- Step 5: Create finished_goods entries for existing product_skus that don't have them
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
)
SELECT 
  ps.tenant_id,
  ps.id,
  ps.sku,
  ps.color,
  'PLA', -- Default material
  0, -- Start with 0 stock
  'printed', -- Default status
  ps.price,
  'out_of_stock'
FROM product_skus ps
LEFT JOIN finished_goods fg ON ps.id = fg.product_sku_id
WHERE ps.is_active = true 
AND fg.id IS NULL;