-- Fix all remaining functions with search_path
CREATE OR REPLACE FUNCTION public.handle_assembly_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only proceed if status changed to 'completed'
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Update finished good status to assembled
    UPDATE public.finished_goods 
    SET 
      assembly_status = 'assembled',
      status = 'in_stock',
      updated_at = now()
    WHERE id = NEW.finished_good_id;
    
    -- Update completed_at timestamp
    NEW.completed_at = now();
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_worklist_task_time_tracking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- When status changes to 'in_progress', set started_at
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' THEN
    NEW.started_at = now();
    NEW.actual_time_minutes = NULL;
    NEW.completed_at = NULL;
  END IF;

  -- When status changes to 'completed', calculate actual time and set completed_at
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.started_at IS NOT NULL THEN
    NEW.completed_at = now();
    NEW.actual_time_minutes = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60;
  END IF;

  -- When status changes to 'cancelled' from 'in_progress', reset timing data but keep started_at for analytics
  IF NEW.status = 'cancelled' AND OLD.status = 'in_progress' THEN
    NEW.completed_at = NULL;
    NEW.actual_time_minutes = NULL;
  END IF;

  -- When status changes back to 'pending', reset all timing data
  IF NEW.status = 'pending' AND OLD.status IN ('in_progress', 'cancelled') THEN
    NEW.started_at = NULL;
    NEW.completed_at = NULL;
    NEW.actual_time_minutes = NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_worklist_task_for_assembly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.worklist_tasks (
    tenant_id,
    title,
    description,
    task_type,
    priority,
    status,
    estimated_time_minutes,
    assembly_task_id,
    metadata
  ) VALUES (
    NEW.tenant_id,
    'Assemble ' || NEW.product_name || ' - ' || NEW.sku,
    'Assemble ' || NEW.quantity || ' unit' || CASE WHEN NEW.quantity > 1 THEN 's' ELSE '' END || ' of ' || NEW.product_name || ' (SKU: ' || NEW.sku || ')' || COALESCE('. Notes: ' || NEW.notes, ''),
    'assembly',
    'medium',
    NEW.status,
    NEW.quantity * 5, -- Estimate 5 minutes per unit
    NEW.id,
    jsonb_build_object(
      'product_name', NEW.product_name,
      'sku', NEW.sku,
      'quantity', NEW.quantity,
      'finished_good_id', NEW.finished_good_id
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_assembly_task_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Update corresponding worklist task status when assembly task status changes
  UPDATE public.worklist_tasks 
  SET 
    status = NEW.status,
    updated_at = now()
  WHERE assembly_task_id = NEW.id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_create_finished_good()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    COALESCE(NEW.filament_type, 'PLA'), -- Use filament_type as material
    NEW.stock_level, -- Use the stock_level from the SKU
    'printed',
    NEW.price,
    CASE 
      WHEN NEW.stock_level <= 0 THEN 'out_of_stock'
      WHEN NEW.stock_level <= 5 THEN 'low_stock'
      ELSE 'in_stock'
    END
  );
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_sku_stock_to_finished_goods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- When stock_level is updated in product_skus, sync to finished_goods
  IF NEW.stock_level != OLD.stock_level THEN
    UPDATE finished_goods 
    SET 
      current_stock = NEW.stock_level,
      status = CASE 
        WHEN NEW.stock_level <= 0 THEN 'out_of_stock'
        WHEN NEW.stock_level <= 5 THEN 'low_stock'
        ELSE 'in_stock'
      END,
      updated_at = now()
    WHERE product_sku_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_stock_level_to_product_skus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- When finished_goods.current_stock is updated, sync to product_skus.stock_level
  IF NEW.current_stock != OLD.current_stock AND NEW.product_sku_id IS NOT NULL THEN
    UPDATE product_skus 
    SET 
      stock_level = NEW.current_stock,
      updated_at = now()
    WHERE id = NEW.product_sku_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tenant_id_var UUID;
BEGIN
  -- Get tenant_id from user metadata if provided
  tenant_id_var := (NEW.raw_user_meta_data->>'tenant_id')::uuid;
  
  -- If no tenant_id provided, this user shouldn't be created via this trigger
  IF tenant_id_var IS NULL THEN
    RAISE EXCEPTION 'User signup must include tenant_id in metadata';
  END IF;

  -- Check if profile already exists (to prevent duplicate inserts)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    -- Profile already exists, just return
    RETURN NEW;
  END IF;

  -- Verify the tenant exists
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = tenant_id_var) THEN
    RAISE EXCEPTION 'Invalid tenant_id provided in user metadata';
  END IF;

  -- Insert profile with the provided tenant_id using first_name and last_name
  INSERT INTO public.profiles (id, tenant_id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    tenant_id_var,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    NEW.raw_user_meta_data->>'last_name',
    'admin' -- First user in a tenant is admin
  );
  
  RETURN NEW;
END;
$function$;