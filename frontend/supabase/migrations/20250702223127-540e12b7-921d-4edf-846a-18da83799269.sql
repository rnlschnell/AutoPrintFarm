
-- Phase 1: Core Infrastructure Tables

-- Tenants table (each subdomain represents a tenant)
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- User profiles with tenant association and roles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'operator', 'viewer')) DEFAULT 'operator',
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- Global color presets per tenant
CREATE TABLE public.color_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  color_name TEXT NOT NULL,
  hex_code TEXT NOT NULL,
  filament_type TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, color_name)
);

-- Phase 2: Printer Fleet Management
CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  firmware_version TEXT,
  total_print_time INTEGER DEFAULT 0,
  last_maintenance_date DATE,
  status TEXT CHECK (status IN ('idle', 'printing', 'maintenance', 'offline')) DEFAULT 'idle',
  current_color TEXT,
  current_filament_type TEXT,
  location TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- Phase 3: Print File Management with Versioning
CREATE TABLE public.print_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE public.print_file_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  print_file_id UUID REFERENCES public.print_files(id) ON DELETE CASCADE NOT NULL,
  version_number INTEGER CHECK (version_number BETWEEN 1 AND 3),
  file_url TEXT,
  notes TEXT,
  is_current_version BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(print_file_id, version_number)
);

-- Phase 4: Print Job Queue Management
CREATE TABLE public.print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  printer_id UUID REFERENCES public.printers(id),
  print_file_id UUID REFERENCES public.print_files(id) NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT CHECK (status IN ('queued', 'printing', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
  color TEXT NOT NULL,
  filament_type TEXT NOT NULL,
  material_type TEXT NOT NULL,
  number_of_units INTEGER NOT NULL DEFAULT 1,
  filament_needed_grams DECIMAL(10,2),
  estimated_print_time_minutes INTEGER,
  actual_print_time_minutes INTEGER,
  progress_percentage INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  submitted_by UUID REFERENCES public.profiles(id),
  time_submitted TIMESTAMPTZ DEFAULT NOW(),
  time_started TIMESTAMPTZ,
  time_completed TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 5: Material Inventory (4 Separate Tables)
CREATE TABLE public.filament_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  color TEXT NOT NULL,
  brand TEXT,
  diameter TEXT DEFAULT '1.75mm',
  remaining_grams DECIMAL(10,2) NOT NULL DEFAULT 0,
  location TEXT,
  status TEXT CHECK (status IN ('in_stock', 'low', 'out_of_stock')) DEFAULT 'in_stock',
  cost_per_unit DECIMAL(10,2),
  low_threshold DECIMAL(10,2) DEFAULT 100,
  reorder_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.packaging_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  color TEXT,
  brand TEXT,
  remaining_units INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  status TEXT CHECK (status IN ('in_stock', 'low', 'out_of_stock')) DEFAULT 'in_stock',
  cost_per_unit DECIMAL(10,2),
  low_threshold INTEGER DEFAULT 10,
  reorder_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.accessories_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  color TEXT,
  brand TEXT,
  diameter TEXT,
  remaining_units INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  status TEXT CHECK (status IN ('in_stock', 'low', 'out_of_stock')) DEFAULT 'in_stock',
  cost_per_unit DECIMAL(10,2),
  low_threshold INTEGER DEFAULT 5,
  reorder_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.printer_parts_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  color TEXT,
  brand TEXT,
  remaining_units INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  status TEXT CHECK (status IN ('in_stock', 'low', 'out_of_stock')) DEFAULT 'in_stock',
  cost_per_unit DECIMAL(10,2),
  low_threshold INTEGER DEFAULT 2,
  reorder_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 6: Finished Goods & Product Management
CREATE TABLE public.product_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  print_time_minutes INTEGER NOT NULL,
  material_usage_grams DECIMAL(10,2) NOT NULL,
  production_cost DECIMAL(10,2) NOT NULL,
  base_selling_price DECIMAL(10,2) NOT NULL,
  specifications TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE public.finished_goods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  product_template_id UUID REFERENCES public.product_templates(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  color TEXT NOT NULL,
  material TEXT NOT NULL,
  quantity_per_sku INTEGER DEFAULT 1,
  current_stock INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK (status IN ('in_stock', 'low_stock', 'out_of_stock')) DEFAULT 'out_of_stock',
  unit_price DECIMAL(10,2) NOT NULL,
  profit_margin DECIMAL(5,2),
  low_stock_threshold INTEGER DEFAULT 5,
  extra_cost DECIMAL(10,2) DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

-- Phase 7: Order Management
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  order_number TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('shopify', 'amazon', 'etsy', 'manual')) NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  order_date TIMESTAMPTZ NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'fulfilled', 'cancelled')) DEFAULT 'pending',
  total_revenue DECIMAL(10,2) NOT NULL,
  shipping_street TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_zip TEXT,
  shipping_country TEXT DEFAULT 'USA',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_number)
);

CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  finished_good_id UUID REFERENCES public.finished_goods(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 8: Analytics & Metrics Storage
CREATE TABLE public.daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  revenue DECIMAL(10,2) DEFAULT 0,
  profit DECIMAL(10,2) DEFAULT 0,
  print_completion_percentage DECIMAL(5,2) DEFAULT 0,
  active_printers INTEGER DEFAULT 0,
  total_printers INTEGER DEFAULT 0,
  utilization_percentage DECIMAL(5,2) DEFAULT 0,
  average_job_time_minutes DECIMAL(10,2) DEFAULT 0,
  time_saved_minutes INTEGER DEFAULT 0,
  units_produced INTEGER DEFAULT 0,
  materials_cost DECIMAL(10,2) DEFAULT 0,
  labor_cost DECIMAL(10,2) DEFAULT 0,
  overhead_cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);

CREATE TABLE public.material_usage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  material_type TEXT NOT NULL,
  material_id UUID NOT NULL,
  print_job_id UUID REFERENCES public.print_jobs(id),
  usage_amount DECIMAL(10,2) NOT NULL,
  usage_date TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);

-- Phase 9: Row Level Security (RLS) Implementation
-- Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.color_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filament_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packaging_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accessories_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_parts_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_usage_history ENABLE ROW LEVEL SECURITY;

-- Create security definer function to get user's tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Create RLS policies for tenant isolation
-- Tenants - only allow users to see their own tenant
CREATE POLICY "Users can view their own tenant" ON public.tenants
  FOR SELECT USING (id = public.get_user_tenant_id());

-- Profiles - users can view profiles from their tenant
CREATE POLICY "Users can view profiles from their tenant" ON public.profiles
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Color presets - tenant isolation
CREATE POLICY "Users can manage color presets for their tenant" ON public.color_presets
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Printers - tenant isolation
CREATE POLICY "Users can manage printers for their tenant" ON public.printers
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Print files - tenant isolation
CREATE POLICY "Users can manage print files for their tenant" ON public.print_files
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Print file versions - through print_files relationship
CREATE POLICY "Users can manage print file versions for their tenant" ON public.print_file_versions
  FOR ALL USING (
    print_file_id IN (
      SELECT id FROM public.print_files WHERE tenant_id = public.get_user_tenant_id()
    )
  );

-- Print jobs - tenant isolation
CREATE POLICY "Users can manage print jobs for their tenant" ON public.print_jobs
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Material inventories - tenant isolation
CREATE POLICY "Users can manage filament inventory for their tenant" ON public.filament_inventory
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage packaging inventory for their tenant" ON public.packaging_inventory
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage accessories inventory for their tenant" ON public.accessories_inventory
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage printer parts inventory for their tenant" ON public.printer_parts_inventory
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Product management - tenant isolation
CREATE POLICY "Users can manage product templates for their tenant" ON public.product_templates
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage finished goods for their tenant" ON public.finished_goods
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Orders - tenant isolation
CREATE POLICY "Users can manage orders for their tenant" ON public.orders
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage order items for their tenant" ON public.order_items
  FOR ALL USING (
    order_id IN (
      SELECT id FROM public.orders WHERE tenant_id = public.get_user_tenant_id()
    )
  );

-- Analytics - tenant isolation
CREATE POLICY "Users can view analytics for their tenant" ON public.daily_analytics
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can view material usage history for their tenant" ON public.material_usage_history
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Trigger to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, tenant_id, email, full_name, role)
  VALUES (
    new.id,
    -- This will need to be set by the application logic based on subdomain
    null, -- tenant_id will be set by application
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    'operator'
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
