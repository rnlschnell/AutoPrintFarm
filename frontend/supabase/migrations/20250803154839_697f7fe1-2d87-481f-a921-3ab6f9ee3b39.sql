-- Add tenant_id columns to tables that need them for better performance and data integrity

-- 1. Add tenant_id to order_items table
ALTER TABLE public.order_items ADD COLUMN tenant_id UUID;

-- 2. Add tenant_id to product_components table  
ALTER TABLE public.product_components ADD COLUMN tenant_id UUID;

-- 3. Add tenant_id to product_skus table
ALTER TABLE public.product_skus ADD COLUMN tenant_id UUID;

-- 4. Populate tenant_id in order_items from parent orders table
UPDATE public.order_items 
SET tenant_id = orders.tenant_id 
FROM public.orders 
WHERE order_items.order_id = orders.id;

-- 5. Populate tenant_id in product_components from parent products table
UPDATE public.product_components 
SET tenant_id = products.tenant_id 
FROM public.products 
WHERE product_components.product_id = products.id;

-- 6. Populate tenant_id in product_skus from parent products table
UPDATE public.product_skus 
SET tenant_id = products.tenant_id 
FROM public.products 
WHERE product_skus.product_id = products.id;

-- 7. Make tenant_id NOT NULL after population
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.product_components ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.product_skus ALTER COLUMN tenant_id SET NOT NULL;

-- 8. Update RLS policies to use direct tenant_id filtering for better performance

-- Drop existing indirect RLS policies
DROP POLICY IF EXISTS "Users can manage order items for their tenant" ON public.order_items;
DROP POLICY IF EXISTS "Users can manage product components for their tenant" ON public.product_components;
DROP POLICY IF EXISTS "Users can manage product SKUs for their tenant" ON public.product_skus;

-- Create new direct RLS policies using tenant_id
CREATE POLICY "Users can manage order items for their tenant" 
ON public.order_items 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage product components for their tenant" 
ON public.product_components 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage product SKUs for their tenant" 
ON public.product_skus 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- 9. Add indexes for performance on new tenant_id columns
CREATE INDEX idx_order_items_tenant_id ON public.order_items(tenant_id);
CREATE INDEX idx_product_components_tenant_id ON public.product_components(tenant_id);
CREATE INDEX idx_product_skus_tenant_id ON public.product_skus(tenant_id);

-- 10. Add composite indexes for common query patterns
CREATE INDEX idx_order_items_tenant_order ON public.order_items(tenant_id, order_id);
CREATE INDEX idx_product_components_tenant_product ON public.product_components(tenant_id, product_id);
CREATE INDEX idx_product_skus_tenant_product ON public.product_skus(tenant_id, product_id);