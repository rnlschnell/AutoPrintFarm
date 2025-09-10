-- Add file_name column to products table
ALTER TABLE public.products 
ADD COLUMN file_name text;