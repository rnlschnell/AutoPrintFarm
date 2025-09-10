-- Update the handle_new_user function to properly set tenant_id from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, tenant_id, email, full_name, role)
  VALUES (
    new.id,
    -- Get tenant_id from user metadata if provided, otherwise null
    COALESCE((new.raw_user_meta_data->>'tenant_id')::uuid, null),
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    'operator'
  );
  RETURN new;
END;
$$;