-- Populate material inventory tables with mock data
INSERT INTO public.filament_inventory (tenant_id, type, color, brand, diameter, remaining_grams, cost_per_unit, location, low_threshold, status) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'PLA', 'Galaxy Black', 'Hatchbox', '1.75mm', 750, 22.99, 'Shelf A1', 100, 'in_stock'),
('550e8400-e29b-41d4-a716-446655440000', 'ABS', 'Ocean Blue', 'eSUN', '1.75mm', 1200, 25.99, 'Shelf A2', 150, 'in_stock'),
('550e8400-e29b-41d4-a716-446655440000', 'PETG', 'Electric Blue', 'Prusament', '1.75mm', 950, 29.99, 'Storage Room B', 150, 'in_stock'),
('550e8400-e29b-41d4-a716-446655440000', 'PLA', 'Signal White', 'Polymaker', '1.75mm', 85, 24.99, 'Shelf A1', 100, 'low');

INSERT INTO public.packaging_inventory (tenant_id, type, color, brand, remaining_units, cost_per_unit, location, low_threshold, status) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Small Box', 'Brown', 'ULINE', 45, 0.85, 'Storage A', 20, 'in_stock'),
('550e8400-e29b-41d4-a716-446655440000', 'Bubble Wrap', 'Clear', 'Duck Brand', 15, 12.99, 'Storage A', 20, 'low');

INSERT INTO public.accessories_inventory (tenant_id, type, color, brand, diameter, remaining_units, cost_per_unit, location, low_threshold, status) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Nozzle', 'Brass', 'E3D', '0.4mm', 12, 8.99, 'Tool Cabinet', 5, 'in_stock');

INSERT INTO public.printer_parts_inventory (tenant_id, type, color, brand, remaining_units, cost_per_unit, location, low_threshold, status) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Stepper Motor', 'Black', 'LDO', 4, 25.99, 'Parts Bin A', 2, 'in_stock');

-- Populate product templates
INSERT INTO public.product_templates (tenant_id, name, description, category, print_time_minutes, material_usage_grams, production_cost, base_selling_price, specifications) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Phone Stand - Universal', 'Adjustable phone stand for most smartphone sizes', 'Accessories', 45, 35, 1.25, 8.99, 'Fits phones 4-7 inches, adjustable angle'),
('550e8400-e29b-41d4-a716-446655440000', 'Dragon Miniature', 'Detailed fantasy dragon figurine', 'Miniatures', 180, 25, 0.95, 15.99, '28mm scale, high detail, no supports needed'),
('550e8400-e29b-41d4-a716-446655440000', 'Industrial Bracket - Type A', 'Heavy-duty mounting bracket for industrial applications', 'Industrial', 120, 85, 3.45, 24.99, 'Load capacity: 50kg, corrosion resistant');

-- Get template IDs for finished goods
DO $$
DECLARE
    phone_stand_id uuid;
    dragon_id uuid;
    bracket_id uuid;
BEGIN
    SELECT id INTO phone_stand_id FROM public.product_templates WHERE name = 'Phone Stand - Universal';
    SELECT id INTO dragon_id FROM public.product_templates WHERE name = 'Dragon Miniature';
    SELECT id INTO bracket_id FROM public.product_templates WHERE name = 'Industrial Bracket - Type A';

    -- Populate finished goods
    INSERT INTO public.finished_goods (tenant_id, product_template_id, sku, color, material, current_stock, unit_price, low_stock_threshold, status) VALUES
    ('550e8400-e29b-41d4-a716-446655440000', phone_stand_id, 'PS-BLK-001', 'Galaxy Black', 'PLA', 25, 8.99, 10, 'in_stock'),
    ('550e8400-e29b-41d4-a716-446655440000', phone_stand_id, 'PS-WHT-001', 'Signal White', 'PLA', 8, 8.99, 10, 'low_stock'),
    ('550e8400-e29b-41d4-a716-446655440000', dragon_id, 'DM-GRN-001', 'Forest Green', 'PETG', 15, 18.49, 5, 'in_stock'),
    ('550e8400-e29b-41d4-a716-446655440000', bracket_id, 'IB-BLK-A001', 'Midnight Black', 'ABS', 45, 24.99, 15, 'in_stock'),
    ('550e8400-e29b-41d4-a716-446655440000', bracket_id, 'IB-BLU-A001', 'Electric Blue', 'PETG', 0, 26.49, 15, 'out_of_stock');
END $$;

-- Populate print files
INSERT INTO public.print_files (tenant_id, name, file_size_bytes) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Benchy.gcode', 12897280),
('550e8400-e29b-41d4-a716-446655440000', 'CalibrationCube.gcode', 1153434),
('550e8400-e29b-41d4-a716-446655440000', 'ArticulatedDragon.gcode', 48025651),
('550e8400-e29b-41d4-a716-446655440000', 'VoronoiVase.gcode', 23592960);

-- Populate print file versions
DO $$
DECLARE
    benchy_id uuid;
    cube_id uuid;
    dragon_id uuid;
    vase_id uuid;
BEGIN
    SELECT id INTO benchy_id FROM public.print_files WHERE name = 'Benchy.gcode';
    SELECT id INTO cube_id FROM public.print_files WHERE name = 'CalibrationCube.gcode';
    SELECT id INTO dragon_id FROM public.print_files WHERE name = 'ArticulatedDragon.gcode';
    SELECT id INTO vase_id FROM public.print_files WHERE name = 'VoronoiVase.gcode';

    INSERT INTO public.print_file_versions (print_file_id, version_number, notes, is_current_version) VALUES
    (benchy_id, 3, 'Optimized for speed.', true),
    (benchy_id, 2, 'Increased infill.', false),
    (benchy_id, 1, 'Initial upload.', false),
    (cube_id, 1, 'Initial upload.', true),
    (dragon_id, 2, 'Added supports.', true),
    (dragon_id, 1, 'Initial upload.', false),
    (vase_id, 1, 'Initial upload.', true);
END $$;

-- Populate orders (using lowercase platform names)
INSERT INTO public.orders (tenant_id, order_number, platform, customer_name, customer_email, order_date, status, total_revenue, shipping_street, shipping_city, shipping_state, shipping_zip, shipping_country) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'ORD-2024-001', 'etsy', 'Sarah Johnson', 'sarah.j@email.com', '2025-06-25', 'pending', 24.98, '123 Main St', 'Springfield', 'IL', '62701', 'USA'),
('550e8400-e29b-41d4-a716-446655440000', 'ORD-2024-002', 'shopify', 'Mike Chen', 'mike.c@email.com', '2025-06-24', 'fulfilled', 15.99, '456 Oak Ave', 'Portland', 'OR', '97201', 'USA'),
('550e8400-e29b-41d4-a716-446655440000', 'B2B-2024-001', 'amazon', 'TechCorp Industries', 'orders@techcorp.com', '2025-06-23', 'pending', 124.95, '789 Industrial Blvd', 'Houston', 'TX', '77001', 'USA');

-- Populate order items
DO $$
DECLARE
    order1_id uuid;
    order2_id uuid;
    order3_id uuid;
    phone_stand_black_id uuid;
    dragon_green_id uuid;
    bracket_black_id uuid;
BEGIN
    SELECT id INTO order1_id FROM public.orders WHERE order_number = 'ORD-2024-001';
    SELECT id INTO order2_id FROM public.orders WHERE order_number = 'ORD-2024-002';
    SELECT id INTO order3_id FROM public.orders WHERE order_number = 'B2B-2024-001';
    SELECT id INTO phone_stand_black_id FROM public.finished_goods WHERE sku = 'PS-BLK-001';
    SELECT id INTO dragon_green_id FROM public.finished_goods WHERE sku = 'DM-GRN-001';
    SELECT id INTO bracket_black_id FROM public.finished_goods WHERE sku = 'IB-BLK-A001';

    INSERT INTO public.order_items (order_id, finished_good_id, sku, product_name, quantity, unit_price, total_price) VALUES
    (order1_id, phone_stand_black_id, 'PS-BLK-001', 'Phone Stand - Universal (Black)', 2, 8.99, 17.98),
    (order1_id, dragon_green_id, 'DM-GRN-001', 'Dragon Miniature (Green)', 1, 18.49, 18.49),
    (order2_id, dragon_green_id, 'DM-GRN-001', 'Dragon Miniature (Green)', 1, 18.49, 18.49),
    (order3_id, bracket_black_id, 'IB-BLK-A001', 'Industrial Bracket - Type A (Black)', 5, 24.99, 124.95);
END $$;

-- Populate print jobs
DO $$
DECLARE
    benchy_file_id uuid;
    dragon_file_id uuid;
    printer1_id uuid;
    printer2_id uuid;
BEGIN
    SELECT id INTO benchy_file_id FROM public.print_files WHERE name = 'Benchy.gcode';
    SELECT id INTO dragon_file_id FROM public.print_files WHERE name = 'ArticulatedDragon.gcode';
    SELECT id INTO printer1_id FROM public.printers WHERE name = 'Printer Beta' LIMIT 1;
    SELECT id INTO printer2_id FROM public.printers WHERE name = 'Production Unit 1' LIMIT 1;

    INSERT INTO public.print_jobs (tenant_id, printer_id, print_file_id, file_name, status, color, filament_type, material_type, number_of_units, progress_percentage, estimated_print_time_minutes, priority, time_submitted) VALUES
    ('550e8400-e29b-41d4-a716-446655440000', printer1_id, benchy_file_id, 'Phone Stand Basic', 'printing', 'Ocean Blue', 'PLA', 'PLA', 1, 65, 45, 1, NOW() - INTERVAL '1 hour'),
    ('550e8400-e29b-41d4-a716-446655440000', printer2_id, dragon_file_id, 'Industrial Bracket', 'printing', 'Electric Blue', 'PETG', 'PETG', 1, 45, 192, 1, NOW() - INTERVAL '2 hours'),
    ('550e8400-e29b-41d4-a716-446655440000', NULL, dragon_file_id, 'Miniature Dragon', 'queued', 'Forest Green', 'PETG', 'PETG', 1, 0, 180, 0, NOW() - INTERVAL '30 minutes'),
    ('550e8400-e29b-41d4-a716-446655440000', NULL, benchy_file_id, 'Custom Enclosure', 'queued', 'Galaxy Black', 'PLA', 'PLA', 1, 0, 120, 0, NOW() - INTERVAL '15 minutes'),
    ('550e8400-e29b-41d4-a716-446655440000', NULL, benchy_file_id, 'Prototype Housing', 'queued', 'Signal White', 'PLA', 'PLA', 1, 0, 90, 0, NOW() - INTERVAL '5 minutes');
END $$;