-- Fix remaining function search path issues
ALTER FUNCTION public.update_updated_at_column() SET search_path = 'public';
ALTER FUNCTION public.get_user_tenant_id() SET search_path = 'public';