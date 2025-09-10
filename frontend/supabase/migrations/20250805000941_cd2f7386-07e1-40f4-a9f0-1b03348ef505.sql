-- Remove product_template_id column from finished_goods table
ALTER TABLE public.finished_goods DROP COLUMN IF EXISTS product_template_id;

-- Drop the product_templates table
DROP TABLE IF EXISTS public.product_templates;