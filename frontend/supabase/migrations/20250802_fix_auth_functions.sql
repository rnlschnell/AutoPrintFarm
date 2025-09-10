-- Function to generate unique subdomain from company name
CREATE OR REPLACE FUNCTION public.generate_unique_subdomain(company_name_input TEXT)
RETURNS TEXT AS $$
DECLARE
  base_subdomain TEXT;
  final_subdomain TEXT;
  counter INT := 0;
BEGIN
  -- Convert company name to subdomain format (lowercase, replace spaces with hyphens)
  base_subdomain := LOWER(REGEXP_REPLACE(company_name_input, '[^a-zA-Z0-9]+', '-', 'g'));
  base_subdomain := TRIM(BOTH '-' FROM base_subdomain);
  
  -- Start with the base subdomain
  final_subdomain := base_subdomain;
  
  -- Check if subdomain exists and add counter if needed
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE subdomain = final_subdomain) LOOP
    counter := counter + 1;
    final_subdomain := base_subdomain || '-' || counter;
  END LOOP;
  
  RETURN final_subdomain;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user signup (creates profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create profile if user has tenant_id in metadata
  IF NEW.raw_user_meta_data->>'tenant_id' IS NOT NULL THEN
    INSERT INTO public.profiles (
      id,
      tenant_id,
      email,
      full_name,
      role,
      is_active
    ) VALUES (
      NEW.id,
      (NEW.raw_user_meta_data->>'tenant_id')::UUID,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      'operator', -- Default role
      true
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.generate_unique_subdomain TO anon;
GRANT EXECUTE ON FUNCTION public.generate_unique_subdomain TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO authenticated;
EOF < /dev/null
