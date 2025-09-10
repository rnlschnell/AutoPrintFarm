-- Add INSERT policy for tenants table to allow new tenant creation during signup
CREATE POLICY "Allow tenant creation during signup"
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Add UPDATE policy for tenant owners (for future use)
CREATE POLICY "Tenant owners can update their tenant"
ON public.tenants
FOR UPDATE
TO authenticated
USING (id = get_user_tenant_id())
WITH CHECK (id = get_user_tenant_id());

-- Add a more restrictive INSERT policy to prevent abuse
-- First drop the previous policy
DROP POLICY "Allow tenant creation during signup" ON public.tenants;

-- Create a more secure INSERT policy
CREATE POLICY "Allow tenant creation during signup"
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK (
  -- Only allow if user doesn't already have a tenant
  NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND tenant_id IS NOT NULL
  )
);