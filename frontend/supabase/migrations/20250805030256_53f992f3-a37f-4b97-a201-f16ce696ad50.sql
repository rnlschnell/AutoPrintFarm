-- Add hex_code column to printers table to store the color hex value
ALTER TABLE public.printers ADD COLUMN current_color_hex text;