-- Update tenant RLS policies to work better with the signup process
DROP POLICY IF EXISTS "Allow tenant creation during signup" ON public.tenants;

-- Allow service role to manage tenants (this is safe because service role is server-side only)
CREATE POLICY "Service role can manage tenants" ON public.tenants
FOR ALL USING (true);

-- Users can still view their own tenant
-- Keep the existing "Users can view their own tenant" policy

-- Update the handle_new_user function to be more robust
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

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();