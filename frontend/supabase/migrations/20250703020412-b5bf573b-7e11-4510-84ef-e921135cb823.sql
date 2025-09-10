-- Add number_of_units column to print_files table
ALTER TABLE print_files ADD COLUMN number_of_units INTEGER DEFAULT 1;

-- Update existing records to have default value
UPDATE print_files SET number_of_units = 1 WHERE number_of_units IS NULL;