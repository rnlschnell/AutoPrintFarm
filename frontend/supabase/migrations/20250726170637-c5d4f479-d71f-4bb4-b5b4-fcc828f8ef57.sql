-- Add columns to finished_goods table to connect with products
ALTER TABLE public.finished_goods 
ADD COLUMN product_sku_id UUID REFERENCES public.product_skus(id),
ADD COLUMN assembly_status TEXT DEFAULT 'printed' CHECK (assembly_status IN ('printed', 'needs_assembly', 'assembled')),
ADD COLUMN print_job_id UUID REFERENCES public.print_jobs(id);

-- Add product_sku_id to print_jobs table
ALTER TABLE public.print_jobs 
ADD COLUMN product_sku_id UUID REFERENCES public.product_skus(id);

-- Create assembly_tasks table for worklist integration
CREATE TABLE public.assembly_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  finished_good_id UUID NOT NULL REFERENCES public.finished_goods(id),
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  assigned_to UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on assembly_tasks
ALTER TABLE public.assembly_tasks ENABLE ROW LEVEL SECURITY;

-- Create policy for assembly_tasks
CREATE POLICY "Users can manage assembly tasks for their tenant" 
ON public.assembly_tasks 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Add trigger for assembly_tasks updated_at
CREATE TRIGGER update_assembly_tasks_updated_at
BEFORE UPDATE ON public.assembly_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle print job completion
CREATE OR REPLACE FUNCTION public.handle_print_job_completion()
RETURNS TRIGGER AS $$
DECLARE
  product_record RECORD;
  finished_good_id UUID;
BEGIN
  -- Only proceed if status changed to 'completed' and product_sku_id exists
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.product_sku_id IS NOT NULL THEN
    -- Get product and SKU information
    SELECT 
      p.name as product_name,
      p.requires_assembly,
      ps.sku,
      ps.color
    INTO product_record
    FROM public.products p
    JOIN public.product_skus ps ON ps.product_id = p.id
    WHERE ps.id = NEW.product_sku_id;
    
    -- Create finished good entry
    INSERT INTO public.finished_goods (
      tenant_id,
      product_sku_id,
      sku,
      color,
      material,
      current_stock,
      assembly_status,
      print_job_id,
      unit_price,
      status
    ) VALUES (
      NEW.tenant_id,
      NEW.product_sku_id,
      product_record.sku,
      product_record.color,
      NEW.filament_type,
      NEW.number_of_units,
      CASE 
        WHEN product_record.requires_assembly THEN 'needs_assembly'
        ELSE 'assembled'
      END,
      NEW.id,
      0, -- Will be updated from product_sku
      CASE 
        WHEN product_record.requires_assembly THEN 'needs_assembly'
        ELSE 'in_stock'
      END
    ) RETURNING id INTO finished_good_id;
    
    -- If assembly required, create assembly task
    IF product_record.requires_assembly THEN
      INSERT INTO public.assembly_tasks (
        tenant_id,
        finished_good_id,
        product_name,
        sku,
        quantity
      ) VALUES (
        NEW.tenant_id,
        finished_good_id,
        product_record.product_name,
        product_record.sku,
        NEW.number_of_units
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for print job completion
CREATE TRIGGER trigger_print_job_completion
  AFTER UPDATE ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_print_job_completion();

-- Create function to handle assembly task completion
CREATE OR REPLACE FUNCTION public.handle_assembly_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if status changed to 'completed'
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Update finished good status to assembled
    UPDATE public.finished_goods 
    SET 
      assembly_status = 'assembled',
      status = 'in_stock',
      updated_at = now()
    WHERE id = NEW.finished_good_id;
    
    -- Update completed_at timestamp
    NEW.completed_at = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for assembly completion
CREATE TRIGGER trigger_assembly_completion
  BEFORE UPDATE ON public.assembly_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_assembly_completion();