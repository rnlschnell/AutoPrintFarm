-- Fix security issues by setting proper search_path for functions
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;