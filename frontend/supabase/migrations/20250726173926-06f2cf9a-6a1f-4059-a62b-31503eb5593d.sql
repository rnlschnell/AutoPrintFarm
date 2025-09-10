-- Create storage policies for print-files bucket if they don't exist

-- Policy to allow uploads to print-files bucket
CREATE POLICY IF NOT EXISTS "Allow uploads to print-files bucket"
ON storage.objects
FOR INSERT 
WITH CHECK (bucket_id = 'print-files');

-- Policy to allow viewing files in print-files bucket
CREATE POLICY IF NOT EXISTS "Allow viewing files in print-files bucket"
ON storage.objects
FOR SELECT 
USING (bucket_id = 'print-files');

-- Policy to allow updating files in print-files bucket
CREATE POLICY IF NOT EXISTS "Allow updating files in print-files bucket"
ON storage.objects
FOR UPDATE 
USING (bucket_id = 'print-files');

-- Policy to allow deleting files in print-files bucket
CREATE POLICY IF NOT EXISTS "Allow deleting files in print-files bucket"
ON storage.objects
FOR DELETE 
USING (bucket_id = 'print-files');