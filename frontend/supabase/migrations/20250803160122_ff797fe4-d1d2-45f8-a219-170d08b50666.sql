-- Fix security warnings by setting search_path for all functions

-- Update handle_worklist_task_time_tracking function
DROP FUNCTION IF EXISTS public.handle_worklist_task_time_tracking();
CREATE OR REPLACE FUNCTION public.handle_worklist_task_time_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

-- Update create_worklist_task_for_assembly function
DROP FUNCTION IF EXISTS public.create_worklist_task_for_assembly();
CREATE OR REPLACE FUNCTION public.create_worklist_task_for_assembly()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

-- Update sync_assembly_task_status function
DROP FUNCTION IF EXISTS public.sync_assembly_task_status();
CREATE OR REPLACE FUNCTION public.sync_assembly_task_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Update corresponding worklist task status when assembly task status changes
  UPDATE public.worklist_tasks 
  SET 
    status = NEW.status,
    updated_at = now()
  WHERE assembly_task_id = NEW.id;

  RETURN NEW;
END;
$$;