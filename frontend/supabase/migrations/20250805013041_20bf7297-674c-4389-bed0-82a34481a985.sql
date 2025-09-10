-- Add printer_id column to printers table
ALTER TABLE public.printers 
ADD COLUMN printer_id INTEGER;

-- Create unique constraint to prevent duplicate printer_ids within a tenant
ALTER TABLE public.printers 
ADD CONSTRAINT unique_printer_id_per_tenant UNIQUE (tenant_id, printer_id);

-- Function to get the next printer_id for a tenant
CREATE OR REPLACE FUNCTION public.get_next_printer_id(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_id INTEGER;
BEGIN
  -- Get the highest printer_id for this tenant and add 1
  SELECT COALESCE(MAX(printer_id), 0) + 1 
  INTO next_id
  FROM public.printers 
  WHERE tenant_id = p_tenant_id;
  
  RETURN next_id;
END;
$$;

-- Trigger function to auto-assign printer_id on insert
CREATE OR REPLACE FUNCTION public.auto_assign_printer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only assign if printer_id is not already set
  IF NEW.printer_id IS NULL THEN
    NEW.printer_id = public.get_next_printer_id(NEW.tenant_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-assign printer_id
CREATE TRIGGER trigger_auto_assign_printer_id
  BEFORE INSERT ON public.printers
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_printer_id();

-- Update existing printers with sequential printer_ids per tenant
WITH ranked_printers AS (
  SELECT 
    id,
    tenant_id,
    ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) as new_printer_id
  FROM public.printers
  WHERE printer_id IS NULL
)
UPDATE public.printers 
SET printer_id = ranked_printers.new_printer_id
FROM ranked_printers
WHERE printers.id = ranked_printers.id;