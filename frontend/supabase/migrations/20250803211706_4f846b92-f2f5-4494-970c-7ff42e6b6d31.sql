-- Reactivate accidentally deactivated SKUs and restore finished goods
UPDATE public.product_skus 
SET is_active = true, updated_at = now()
WHERE is_active = false 
AND tenant_id = get_user_tenant_id()
AND created_at > now() - interval '1 hour'; -- Only recent deactivations

-- Reactivate corresponding finished goods entries
UPDATE public.finished_goods 
SET is_active = true, updated_at = now()
WHERE is_active = false 
AND tenant_id = get_user_tenant_id()
AND created_at > now() - interval '1 hour';