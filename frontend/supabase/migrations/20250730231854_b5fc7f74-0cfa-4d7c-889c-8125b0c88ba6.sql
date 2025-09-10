-- Update the handle_new_user function to create tenants during signup
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
  -- (they should go through the proper onboarding flow)
  IF tenant_id_var IS NULL THEN
    RAISE EXCEPTION 'User signup must include tenant_id in metadata';
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
$function$;

-- Create function to generate unique subdomain from company name
CREATE OR REPLACE FUNCTION public.generate_unique_subdomain(company_name_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
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