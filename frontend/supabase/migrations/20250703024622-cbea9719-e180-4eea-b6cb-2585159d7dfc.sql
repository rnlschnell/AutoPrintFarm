-- Update storage policies to be more permissive until authentication is implemented
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view inventory photos for their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload inventory photos for their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can update inventory photos for their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete inventory photos for their tenant" ON storage.objects;

-- Create temporary permissive policies for development
CREATE POLICY "Allow public access to inventory photos" 
ON storage.objects 
FOR ALL 
USING (bucket_id = 'inventory-photos');

-- Note: These policies should be updated when authentication is implemented