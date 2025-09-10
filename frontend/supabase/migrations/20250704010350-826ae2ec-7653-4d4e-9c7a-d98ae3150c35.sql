-- Add sort_order column to printers table for persistent ordering
ALTER TABLE public.printers 
ADD COLUMN sort_order integer DEFAULT 0;

-- Update existing printers with incremental sort order
UPDATE public.printers 
SET sort_order = ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at);

-- Create index for better performance
CREATE INDEX idx_printers_sort_order ON public.printers(tenant_id, sort_order);