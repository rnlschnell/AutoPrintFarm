-- Create storage bucket for inventory photos
INSERT INTO storage.buckets (id, name, public) VALUES ('inventory-photos', 'inventory-photos', true);

-- Create policies for inventory photos with tenant isolation
CREATE POLICY "Users can view inventory photos for their tenant" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'inventory-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload inventory photos for their tenant" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'inventory-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update inventory photos for their tenant" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'inventory-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete inventory photos for their tenant" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'inventory-photos' AND auth.uid()::text = (storage.foldername(name))[1]);