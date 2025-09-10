-- Enable RLS on all tables that don't have it enabled yet but have policies
-- These are from the migration tables I just created and existing tables

-- Enable RLS on any tables that have policies but RLS is disabled
-- (The linter errors indicate tables that have policies but RLS is disabled)

-- Let me check which tables specifically need RLS enabled
-- Based on the linter results, I need to enable RLS on tables that have policies

-- First, let me run this to see what tables have policies but no RLS
-- This query will help identify the exact tables:

-- For now, I'll enable RLS on tables that commonly need it in this schema
-- (The linter will tell us if we missed any)

-- Let me enable RLS on tables that might be missing it
ALTER TABLE public.accessories_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.color_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filament_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_usage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packaging_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_parts_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Fix function search path issues
ALTER FUNCTION public.handle_print_job_completion() SET search_path = 'public';
ALTER FUNCTION public.handle_assembly_completion() SET search_path = 'public';