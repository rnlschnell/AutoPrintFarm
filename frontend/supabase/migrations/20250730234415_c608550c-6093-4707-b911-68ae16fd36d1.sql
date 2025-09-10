-- Fix the function search path security warning
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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

  -- Insert profile with the provided tenant_id
  INSERT INTO public.profiles (id, tenant_id, email, full_name, role)
  VALUES (
    NEW.id,
    tenant_id_var,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'admin' -- First user in a tenant is admin
  );
  
  RETURN NEW;
END;
$$;