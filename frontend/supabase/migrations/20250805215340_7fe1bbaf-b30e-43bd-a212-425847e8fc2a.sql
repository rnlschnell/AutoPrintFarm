-- Fix remaining functions with proper search_path
CREATE OR REPLACE FUNCTION public.get_next_printer_id(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.auto_assign_printer_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only assign if printer_id is not already set
  IF NEW.printer_id IS NULL THEN
    NEW.printer_id = public.get_next_printer_id(NEW.tenant_id);
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_unique_subdomain(company_name_input text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  base_subdomain TEXT;
  final_subdomain TEXT;
  counter INTEGER := 0;
BEGIN
  -- Convert company name to subdomain format
  base_subdomain := lower(trim(company_name_input));
  base_subdomain := regexp_replace(base_subdomain, '[^a-z0-9]', '-', 'g');
  base_subdomain := regexp_replace(base_subdomain, '-+', '-', 'g');
  base_subdomain := trim(base_subdomain, '-');
  
  -- Ensure minimum length
  IF length(base_subdomain) < 3 THEN
    base_subdomain := base_subdomain || '-company';
  END IF;
  
  -- Check if base subdomain is available
  final_subdomain := base_subdomain;
  
  -- If not available, try with numbers
  WHILE EXISTS (SELECT 1 FROM tenants WHERE subdomain = final_subdomain) LOOP
    counter := counter + 1;
    final_subdomain := base_subdomain || '-' || counter::TEXT;
  END LOOP;
  
  RETURN final_subdomain;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_print_job_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  product_record RECORD;
  finished_good_id UUID;
BEGIN
  -- Only proceed if status changed to 'completed' and product_sku_id exists
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.product_sku_id IS NOT NULL THEN
    -- Get product and SKU information
    SELECT 
      p.name as product_name,
      p.requires_assembly,
      ps.sku,
      ps.color
    INTO product_record
    FROM public.products p
    JOIN public.product_skus ps ON ps.product_id = p.id
    WHERE ps.id = NEW.product_sku_id;
    
    -- Create finished good entry
    INSERT INTO public.finished_goods (
      tenant_id,
      product_sku_id,
      sku,
      color,
      material,
      current_stock,
      assembly_status,
      print_job_id,
      unit_price,
      status
    ) VALUES (
      NEW.tenant_id,
      NEW.product_sku_id,
      product_record.sku,
      product_record.color,
      NEW.filament_type,
      NEW.number_of_units,
      CASE 
        WHEN product_record.requires_assembly THEN 'needs_assembly'
        ELSE 'assembled'
      END,
      NEW.id,
      0, -- Will be updated from product_sku
      CASE 
        WHEN product_record.requires_assembly THEN 'needs_assembly'
        ELSE 'in_stock'
      END
    ) RETURNING id INTO finished_good_id;
    
    -- If assembly required, create assembly task
    IF product_record.requires_assembly THEN
      INSERT INTO public.assembly_tasks (
        tenant_id,
        finished_good_id,
        product_name,
        sku,
        quantity
      ) VALUES (
        NEW.tenant_id,
        finished_good_id,
        product_record.product_name,
        product_record.sku,
        NEW.number_of_units
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;