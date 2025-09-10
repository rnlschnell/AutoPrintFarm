-- Update profiles table to use first_name and last_name instead of full_name
ALTER TABLE public.profiles 
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT;

-- Migrate existing full_name data to first_name and last_name
UPDATE public.profiles 
SET 
  first_name = CASE 
    WHEN full_name IS NOT NULL AND position(' ' in full_name) > 0 
    THEN split_part(full_name, ' ', 1)
    ELSE full_name
  END,
  last_name = CASE 
    WHEN full_name IS NOT NULL AND position(' ' in full_name) > 0 
    THEN substring(full_name from position(' ' in full_name) + 1)
    ELSE NULL
  END
WHERE full_name IS NOT NULL;

-- Make first_name required but allow last_name to be optional
ALTER TABLE public.profiles 
ALTER COLUMN first_name SET NOT NULL;

-- Drop the old full_name column
ALTER TABLE public.profiles 
DROP COLUMN full_name;

-- Update the handle_new_user function to work with first_name and last_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
$$;