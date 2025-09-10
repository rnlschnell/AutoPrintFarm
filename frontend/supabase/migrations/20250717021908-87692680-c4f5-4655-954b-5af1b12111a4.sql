-- Add manufacturer column to printers table
ALTER TABLE public.printers 
ADD COLUMN manufacturer text;