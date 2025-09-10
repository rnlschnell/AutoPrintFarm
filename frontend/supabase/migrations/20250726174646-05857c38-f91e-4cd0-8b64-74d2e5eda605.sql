-- Fix RLS policies for development mode
-- Allow the development tenant to manage print files and products

-- Update print_files RLS policy to allow development tenant
DROP POLICY IF EXISTS "Users can manage print files for their tenant" ON public.print_files;
CREATE POLICY "Users can manage print files for their tenant" 
ON public.print_files 
FOR ALL 
USING (
  tenant_id = get_user_tenant_id() OR 
  tenant_id = '11111111-1111-1111-1111-111111111111' -- Development tenant
);

-- Update print_file_versions RLS policy to allow development tenant
DROP POLICY IF EXISTS "Users can manage print file versions for their tenant" ON public.print_file_versions;
CREATE POLICY "Users can manage print file versions for their tenant" 
ON public.print_file_versions 
FOR ALL 
USING (
  print_file_id IN (
    SELECT id FROM print_files 
    WHERE tenant_id = get_user_tenant_id() OR 
          tenant_id = '11111111-1111-1111-1111-111111111111'
  )
);

-- Update products RLS policy to allow development tenant
DROP POLICY IF EXISTS "Users can manage products for their tenant" ON public.products;
CREATE POLICY "Users can manage products for their tenant" 
ON public.products 
FOR ALL 
USING (
  tenant_id = get_user_tenant_id() OR 
  tenant_id = '11111111-1111-1111-1111-111111111111' -- Development tenant
);