-- Create storage bucket for print files
INSERT INTO storage.buckets (id, name, public) VALUES ('print-files', 'print-files', true);

-- Create policies for print file uploads
CREATE POLICY "Print files are publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'print-files');

CREATE POLICY "Users can upload print files for their tenant" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'print-files' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can update print files for their tenant" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'print-files' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete print files for their tenant" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'print-files' AND auth.uid() IS NOT NULL);