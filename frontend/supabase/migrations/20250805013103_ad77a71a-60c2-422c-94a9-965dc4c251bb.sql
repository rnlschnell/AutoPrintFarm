-- Fix security warnings by setting search_path on the new functions
DROP FUNCTION IF EXISTS public.get_next_printer_id(UUID);
DROP FUNCTION IF EXISTS public.auto_assign_printer_id();

-- Recreate function with proper search_path
CREATE OR REPLACE FUNCTION public.get_next_printer_id(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- Recreate trigger function with proper search_path
CREATE OR REPLACE FUNCTION public.auto_assign_printer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only assign if printer_id is not already set
  IF NEW.printer_id IS NULL THEN
    NEW.printer_id = public.get_next_printer_id(NEW.tenant_id);
  END IF;
  
  RETURN NEW;
END;
$$;