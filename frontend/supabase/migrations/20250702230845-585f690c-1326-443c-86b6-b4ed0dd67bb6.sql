-- Insert sample tenant
INSERT INTO tenants (id, company_name, subdomain) 
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'Demo 3D Print Shop', 'demo-shop')
ON CONFLICT (id) DO NOTHING;

-- Insert sample user profile
INSERT INTO profiles (id, tenant_id, email, full_name, role) 
VALUES ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'demo@example.com', 'Demo User', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Insert sample printers with proper data types
INSERT INTO printers (id, tenant_id, name, model, status, current_color, current_filament_type, location, firmware_version, total_print_time, is_active) VALUES
('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440000', 'Ender 3 Pro #1', 'Creality Ender 3 Pro', 'idle', 'Galaxy Black', 'PLA', 'Workshop A', 'v2.1.0', 145, true),
('550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440000', 'Prusa MK3S+ #1', 'Prusa i3 MK3S+', 'printing', 'Signal White', 'PETG', 'Workshop A', 'v3.12.0', 289, true),
('550e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440000', 'Bambu X1 Carbon', 'Bambu Lab X1 Carbon', 'idle', 'Transparent Blue', 'ABS', 'Workshop B', 'v1.07.01', 67, true),
('550e8400-e29b-41d4-a716-446655440013', '550e8400-e29b-41d4-a716-446655440000', 'Ultimaker S3', 'Ultimaker S3', 'maintenance', 'Red', 'PLA', 'Workshop B', 'v6.3.0', 423, true),
('550e8400-e29b-41d4-a716-446655440014', '550e8400-e29b-41d4-a716-446655440000', 'Formlabs Form 3', 'Formlabs Form 3', 'offline', 'Clear', 'Resin', 'Clean Room', 'v2.20.1', 156, true)
ON CONFLICT (id) DO NOTHING;