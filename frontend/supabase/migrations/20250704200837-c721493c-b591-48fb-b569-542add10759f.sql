-- Insert sample tenant data for development/testing
INSERT INTO public.tenants (id, subdomain, company_name, is_active)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'demo', 'Demo Company', true),
  ('22222222-2222-2222-2222-222222222222', 'acme', 'Acme Corp', true),
  ('33333333-3333-3333-3333-333333333333', 'test', 'Test Organization', true)
ON CONFLICT (subdomain) DO NOTHING;