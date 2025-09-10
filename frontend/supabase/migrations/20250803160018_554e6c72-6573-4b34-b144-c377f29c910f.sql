-- Create comprehensive worklist_tasks table for all types of tasks
CREATE TABLE public.worklist_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('assembly', 'filament_change', 'collection', 'maintenance', 'quality_check')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  assigned_to UUID,
  estimated_time_minutes INTEGER,
  actual_time_minutes INTEGER,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  due_date TIMESTAMP WITH TIME ZONE,
  printer_id UUID,
  order_number TEXT,
  assembly_task_id UUID, -- FK to assembly_tasks
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.worklist_tasks ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Users can manage worklist tasks for their tenant" 
ON public.worklist_tasks 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Add indexes for performance
CREATE INDEX idx_worklist_tasks_tenant_id ON public.worklist_tasks(tenant_id);
CREATE INDEX idx_worklist_tasks_status ON public.worklist_tasks(tenant_id, status);
CREATE INDEX idx_worklist_tasks_type ON public.worklist_tasks(tenant_id, task_type);
CREATE INDEX idx_worklist_tasks_assigned ON public.worklist_tasks(tenant_id, assigned_to);
CREATE INDEX idx_worklist_tasks_assembly ON public.worklist_tasks(assembly_task_id) WHERE assembly_task_id IS NOT NULL;

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_worklist_tasks_updated_at
  BEFORE UPDATE ON public.worklist_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger to automatically calculate actual_time_minutes and set completed_at
CREATE OR REPLACE FUNCTION public.handle_worklist_task_time_tracking()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes to 'in_progress', set started_at
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' THEN
    NEW.started_at = now();
    NEW.actual_time_minutes = NULL;
    NEW.completed_at = NULL;
  END IF;

  -- When status changes to 'completed', calculate actual time and set completed_at
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.started_at IS NOT NULL THEN
    NEW.completed_at = now();
    NEW.actual_time_minutes = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60;
  END IF;

  -- When status changes to 'cancelled' from 'in_progress', reset timing data but keep started_at for analytics
  IF NEW.status = 'cancelled' AND OLD.status = 'in_progress' THEN
    NEW.completed_at = NULL;
    NEW.actual_time_minutes = NULL;
  END IF;

  -- When status changes back to 'pending', reset all timing data
  IF NEW.status = 'pending' AND OLD.status IN ('in_progress', 'cancelled') THEN
    NEW.started_at = NULL;
    NEW.completed_at = NULL;
    NEW.actual_time_minutes = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for time tracking
CREATE TRIGGER worklist_task_time_tracking
  BEFORE UPDATE ON public.worklist_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_worklist_task_time_tracking();

-- Create trigger to auto-create worklist tasks for assembly tasks
CREATE OR REPLACE FUNCTION public.create_worklist_task_for_assembly()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.worklist_tasks (
    tenant_id,
    title,
    description,
    task_type,
    priority,
    status,
    estimated_time_minutes,
    assembly_task_id,
    metadata
  ) VALUES (
    NEW.tenant_id,
    'Assemble ' || NEW.product_name || ' - ' || NEW.sku,
    'Assemble ' || NEW.quantity || ' unit' || CASE WHEN NEW.quantity > 1 THEN 's' ELSE '' END || ' of ' || NEW.product_name || ' (SKU: ' || NEW.sku || ')' || COALESCE('. Notes: ' || NEW.notes, ''),
    'assembly',
    'medium',
    NEW.status,
    NEW.quantity * 5, -- Estimate 5 minutes per unit
    NEW.id,
    jsonb_build_object(
      'product_name', NEW.product_name,
      'sku', NEW.sku,
      'quantity', NEW.quantity,
      'finished_good_id', NEW.finished_good_id
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for assembly task creation
CREATE TRIGGER create_worklist_task_on_assembly_insert
  AFTER INSERT ON public.assembly_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.create_worklist_task_for_assembly();

-- Create trigger to sync assembly task status changes with worklist tasks
CREATE OR REPLACE FUNCTION public.sync_assembly_task_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update corresponding worklist task status when assembly task status changes
  UPDATE public.worklist_tasks 
  SET 
    status = NEW.status,
    updated_at = now()
  WHERE assembly_task_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for assembly task status sync
CREATE TRIGGER sync_assembly_status_to_worklist
  AFTER UPDATE ON public.assembly_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_assembly_task_status();