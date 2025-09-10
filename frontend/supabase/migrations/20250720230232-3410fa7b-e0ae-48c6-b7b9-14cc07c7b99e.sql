-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  print_file_id UUID,
  requires_assembly BOOLEAN DEFAULT false,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create product_skus table
CREATE TABLE public.product_skus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL,
  sku TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  stock_level INTEGER NOT NULL DEFAULT 0,
  price NUMERIC,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create product_components table
CREATE TABLE public.product_components (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL,
  component_name TEXT NOT NULL,
  component_type TEXT, -- e.g., 'keychain', 'double_sided_tape', etc.
  quantity_required INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_components ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for products
CREATE POLICY "Users can manage products for their tenant"
ON public.products
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create RLS policies for product_skus  
CREATE POLICY "Users can manage product SKUs for their tenant"
ON public.product_skus
FOR ALL
USING (product_id IN (
  SELECT id FROM public.products WHERE tenant_id = get_user_tenant_id()
));

-- Create RLS policies for product_components
CREATE POLICY "Users can manage product components for their tenant"
ON public.product_components
FOR ALL
USING (product_id IN (
  SELECT id FROM public.products WHERE tenant_id = get_user_tenant_id()
));

-- Create triggers for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_skus_updated_at
  BEFORE UPDATE ON public.product_skus
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add foreign key constraints
ALTER TABLE public.product_skus
ADD CONSTRAINT fk_product_skus_product_id
FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.product_components
ADD CONSTRAINT fk_product_components_product_id
FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

-- Update print_files table to link to products instead of being standalone
ALTER TABLE public.print_files
ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;