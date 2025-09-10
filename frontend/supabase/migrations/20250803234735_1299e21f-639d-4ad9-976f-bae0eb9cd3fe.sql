-- Add filament_type and hex_code columns to product_skus table
ALTER TABLE product_skus 
ADD COLUMN filament_type text,
ADD COLUMN hex_code text;