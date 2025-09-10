-- Add sort_order column to printers table for persistent ordering
ALTER TABLE public.printers 
ADD COLUMN sort_order integer DEFAULT 0;

-- Update existing printers with incremental sort order using a subquery
WITH numbered_printers AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at) as new_order
  FROM public.printers
)
UPDATE public.printers 
SET sort_order = numbered_printers.new_order
FROM numbered_printers
WHERE public.printers.id = numbered_printers.id;

-- Create index for better performance
CREATE INDEX idx_printers_sort_order ON public.printers(tenant_id, sort_order);