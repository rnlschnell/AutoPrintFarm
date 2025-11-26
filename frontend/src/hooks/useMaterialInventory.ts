import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api-client';

export type InventoryType = 'Filament' | 'Packaging' | 'Components' | 'Printer Parts';

export interface MaterialInventoryItem {
  id: string;
  type: string;
  color: string;
  brand?: string;
  remaining_grams?: number;
  remaining_units?: number;
  location?: string;
  status?: string;
  cost_per_unit?: number;
  low_threshold?: number;
  reorder_link?: string;
  tenant_id: string;
  created_at?: string;
  updated_at?: string;
  // Additional fields for compatibility
  diameter?: string;
  category?: InventoryType;
  remaining?: number;
  usageHistory?: any[];
}

const getApiPath = (category: InventoryType): string => {
  switch (category) {
    case 'Filament': return '/api/v1/materials/filament';
    case 'Packaging': return '/api/v1/materials/packaging';
    case 'Components': return '/api/v1/materials/components';
    case 'Printer Parts': return '/api/v1/materials/parts';
    default: return '/api/v1/materials/filament';
  }
};

export const useMaterialInventory = () => {
  const [materials, setMaterials] = useState<MaterialInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenantId } = useAuth();

  const fetchMaterials = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const categories: InventoryType[] = ['Filament', 'Packaging', 'Components', 'Printer Parts'];
      const allMaterials: MaterialInventoryItem[] = [];

      for (const category of categories) {
        const apiPath = getApiPath(category);

        try {
          const data = await api.get<any[]>(apiPath);

          const categoryMaterials = (data || []).map((item: any) => ({
            ...item,
            color: item.color || '',
            category,
            remaining: category === 'Filament' ? item.remaining_grams : item.remaining_units,
            usageHistory: []
          }));

          allMaterials.push(...categoryMaterials);
        } catch (err) {
          // Skip this category if the endpoint returns an error (table might not exist yet)
          console.warn(`Error fetching ${category}:`, err);
          // Continue with other categories
        }
      }

      setMaterials(allMaterials);
    } catch (error: any) {
      console.error('Error fetching materials:', error);
      if (error instanceof ApiError && error.isAuthError()) {
        // Don't show toast for auth errors - let AuthContext handle it
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load materials from database.",
        variant: "destructive",
      });
      setMaterials([]);
    } finally {
      setLoading(false);
    }
  };

  const addMaterial = async (category: InventoryType, materialData: {
    type: string;
    color?: string;
    brand?: string;
    remaining: number;
    diameter?: string;
    location?: string;
    cost_per_unit?: number;
    low_threshold?: number;
    reorder_link?: string;
  }) => {
    if (!tenantId) {
      throw new Error('No tenant ID available');
    }

    try {
      const apiPath = getApiPath(category);

      const insertData: any = {
        type: materialData.type,
        brand: materialData.brand || undefined,
        location: materialData.location || undefined,
        cost_per_unit: materialData.cost_per_unit,
        low_threshold: materialData.low_threshold,
        reorder_link: materialData.reorder_link || undefined,
      };

      // Only add color for filament (required field)
      if (category === 'Filament') {
        insertData.color = materialData.color || 'Unknown';
        insertData.remaining_grams = materialData.remaining;
      } else {
        insertData.remaining_units = materialData.remaining;
      }

      const data = await api.post<any>(apiPath, insertData);

      const newMaterial: MaterialInventoryItem = {
        ...data,
        color: data.color || '',
        category,
        remaining: category === 'Filament' ? data.remaining_grams : data.remaining_units,
        usageHistory: []
      };

      setMaterials(prev => [newMaterial, ...prev]);
      toast({
        title: "Success",
        description: `${materialData.type} has been added to ${category} inventory.`,
      });

      return newMaterial;
    } catch (error: any) {
      console.error('Error adding material:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to add material to database.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateMaterial = async (id: string, category: InventoryType, updates: Partial<MaterialInventoryItem>) => {
    try {
      const apiPath = getApiPath(category);

      const updateData: any = { ...updates };

      // Handle remaining quantity field mapping
      if (updates.remaining !== undefined) {
        if (category === 'Filament') {
          updateData.remaining_grams = updates.remaining;
          delete updateData.remaining;
        } else {
          updateData.remaining_units = updates.remaining;
          delete updateData.remaining;
        }
      }

      // Remove incompatible fields
      delete updateData.category;
      delete updateData.spoolSize;
      delete updateData.usageHistory;
      delete updateData.id;
      delete updateData.tenant_id;
      delete updateData.created_at;
      delete updateData.updated_at;

      // Remove color field for non-filament categories
      if (category !== 'Filament') {
        delete updateData.color;
      }

      const data = await api.patch<any>(`${apiPath}/${id}`, updateData);

      const updatedMaterial: MaterialInventoryItem = {
        ...data,
        color: data.color || '',
        category,
        remaining: category === 'Filament' ? data.remaining_grams : data.remaining_units,
        usageHistory: []
      };

      setMaterials(prev => prev.map(material =>
        material.id === id ? updatedMaterial : material
      ));

      toast({
        title: "Success",
        description: "Material updated successfully.",
      });

      return updatedMaterial;
    } catch (error: any) {
      console.error('Error updating material:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update material.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteMaterial = async (id: string, category: InventoryType) => {
    try {
      const apiPath = getApiPath(category);

      await api.delete(`${apiPath}/${id}`);

      setMaterials(prev => prev.filter(material => material.id !== id));
      toast({
        title: "Success",
        description: "Material deleted successfully.",
      });
    } catch (error: any) {
      console.error('Error deleting material:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete material.",
        variant: "destructive",
      });
      throw error;
    }
  };

  /**
   * Consume a component from inventory (decrement quantity)
   * Used during assembly completion
   */
  const consumeComponent = async (
    componentId: string,
    quantity: number,
    options?: {
      reason?: 'assembly_completion' | 'manual_adjustment' | 'damaged' | 'other';
      assembly_task_id?: string;
      notes?: string;
    }
  ) => {
    try {
      const response = await api.post<{
        data: any;
        consumed: {
          quantity: number;
          reason: string;
          assembly_task_id?: string;
          notes?: string;
          previous_quantity: number;
          new_quantity: number;
        };
      }>(`/api/v1/materials/components/${componentId}/consume`, {
        quantity,
        reason: options?.reason || 'assembly_completion',
        assembly_task_id: options?.assembly_task_id,
        notes: options?.notes,
      });

      // Update local state with new quantity
      if (response.data) {
        const updatedMaterial: MaterialInventoryItem = {
          ...response.data,
          color: response.data.color || '',
          category: 'Components' as InventoryType,
          remaining: response.data.remaining_units,
          usageHistory: []
        };

        setMaterials(prev => prev.map(material =>
          material.id === componentId ? updatedMaterial : material
        ));
      }

      return response;
    } catch (error: any) {
      console.error('Error consuming component:', error);
      throw error;
    }
  };

  /**
   * Check availability of multiple components at once
   * Used to validate assembly before completion
   */
  const checkComponentAvailability = async (
    components: Array<{ component_type: string; quantity_needed: number }>
  ): Promise<{
    has_shortage: boolean;
    components: Array<{
      component_type: string;
      quantity_needed: number;
      quantity_available: number;
      has_shortage: boolean;
      shortage_amount: number;
      component_id: string | null;
    }>;
  }> => {
    try {
      const response = await api.post<{
        has_shortage: boolean;
        components: Array<{
          component_type: string;
          quantity_needed: number;
          quantity_available: number;
          has_shortage: boolean;
          shortage_amount: number;
          component_id: string | null;
        }>;
      }>('/api/v1/materials/components/check-availability', { components });

      return response;
    } catch (error: any) {
      console.error('Error checking component availability:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (tenantId) {
      fetchMaterials();
    }
  }, [tenantId]);

  return {
    materials,
    loading,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    consumeComponent,
    checkComponentAvailability,
    refetch: fetchMaterials
  };
};
