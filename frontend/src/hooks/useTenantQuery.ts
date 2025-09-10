import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

/**
 * Custom hook for tenant-scoped queries
 * Automatically filters data by tenant_id and handles authentication
 */
export const useTenantQuery = <T = any>(
  queryKey: string[],
  queryFn: () => Promise<T[]>,
  options?: {
    enabled?: boolean;
  }
) => {
  const { tenant, tenantId } = useTenant();
  
  return useQuery({
    queryKey: ['tenant', tenant?.id, ...queryKey],
    queryFn,
    enabled: !!(tenant && tenantId && (options?.enabled !== false)),
  });
};

/**
 * Helper function to create tenant-scoped query functions
 */
export const createTenantQuery = <T = any>(
  tableName: string,
  options?: {
    select?: string;
    filters?: Record<string, any>;
    orderBy?: { column: string; ascending?: boolean };
  }
) => {
  return async (tenantId: string): Promise<T[]> => {
    let query = supabase
      .from(tableName as any)
      .select(options?.select || '*')
      .eq('tenant_id', tenantId);

    // Apply additional filters
    if (options?.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

    // Apply ordering
    if (options?.orderBy) {
      query = query.order(options.orderBy.column, { 
        ascending: options.orderBy.ascending ?? true 
      });
    }

    const { data, error } = await query;
    
    if (error) {
      throw error;
    }
    
    return data as T[];
  };
};

/**
 * Custom hook for tenant-scoped mutations
 * Automatically adds tenant_id to insert/update operations
 */
export const useTenantMutation = <T = any>(
  mutationFn: (data: any, tenantId: string) => Promise<T>,
  options?: {
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
    invalidateQueries?: string[];
  }
) => {
  const { tenant, tenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      if (!tenant || !tenantId) {
        throw new Error('No tenant context');
      }

      return mutationFn(data, tenantId);
    },
    onSuccess: (data) => {
      // Invalidate related queries
      if (options?.invalidateQueries) {
        options.invalidateQueries.forEach(queryKey => {
          queryClient.invalidateQueries({ 
            queryKey: ['tenant', tenant?.id, queryKey] 
          });
        });
      }
      
      options?.onSuccess?.(data);
    },
    onError: options?.onError,
  });
};

/**
 * Helper functions for common mutation operations
 */
export const createTenantInsert = <T = any>(tableName: string) => {
  return async (data: any, tenantId: string): Promise<T> => {
    const { data: result, error } = await supabase
      .from(tableName as any)
      .insert({ ...data, tenant_id: tenantId })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return result as T;
  };
};

export const createTenantUpdate = <T = any>(tableName: string) => {
  return async (data: { id: string; updates: any }, tenantId: string): Promise<T> => {
    const { data: result, error } = await supabase
      .from(tableName as any)
      .update(data.updates)
      .eq('id', data.id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return result as T;
  };
};

export const createTenantDelete = (tableName: string) => {
  return async (id: string, tenantId: string): Promise<void> => {
    const { error } = await supabase
      .from(tableName as any)
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      throw error;
    }
  };
};