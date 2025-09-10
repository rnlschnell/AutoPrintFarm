-- Enable RLS on orders table (CRITICAL FIX)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Add proper search_path to functions for security
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_printer_id(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_id INTEGER;
BEGIN
  -- Get the highest printer_id for this tenant and add 1
  SELECT COALESCE(MAX(printer_id), 0) + 1 
  INTO next_id
  FROM public.printers 
  WHERE tenant_id = p_tenant_id;
  
  RETURN next_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_assign_printer_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only assign if printer_id is not already set
  IF NEW.printer_id IS NULL THEN
    NEW.printer_id = public.get_next_printer_id(NEW.tenant_id);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create function to check if user is admin (prevents privilege escalation)
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role = 'admin'
  );
$function$;

-- Create audit table for tracking sensitive operations
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  table_name text,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for audit logs (only admins can read)
CREATE POLICY "Admins can view audit logs for their tenant" 
ON public.audit_logs 
FOR SELECT 
USING (tenant_id = get_user_tenant_id() AND is_admin(auth.uid()));

-- Create policy to allow system to insert audit logs
CREATE POLICY "System can insert audit logs" 
ON public.audit_logs 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

-- Add trigger to audit role changes
CREATE OR REPLACE FUNCTION public.audit_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only audit role changes
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      table_name,
      record_id,
      old_values,
      new_values,
      metadata
    ) VALUES (
      NEW.tenant_id,
      auth.uid(),
      'role_change',
      'profiles',
      NEW.id,
      jsonb_build_object('role', OLD.role),
      jsonb_build_object('role', NEW.role),
      jsonb_build_object(
        'changed_user_email', NEW.email,
        'changed_by', auth.uid(),
        'timestamp', now()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger for profile auditing
DROP TRIGGER IF EXISTS audit_profile_changes_trigger ON public.profiles;
CREATE TRIGGER audit_profile_changes_trigger
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_profile_changes();

-- Add policy to prevent non-admins from changing roles
CREATE POLICY "Only admins can change user roles" 
ON public.profiles 
FOR UPDATE 
USING (
  CASE 
    WHEN OLD.role IS DISTINCT FROM NEW.role THEN is_admin(auth.uid())
    ELSE tenant_id = get_user_tenant_id()
  END
)
WITH CHECK (
  CASE 
    WHEN OLD.role IS DISTINCT FROM NEW.role THEN is_admin(auth.uid())
    ELSE tenant_id = get_user_tenant_id()
  END
);