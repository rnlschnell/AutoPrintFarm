import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';

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

const getTableName = (category: InventoryType) => {
  switch (category) {
    case 'Filament': return 'filament_inventory' as const;
    case 'Packaging': return 'packaging_inventory' as const;
    case 'Components': return 'accessories_inventory' as const;
    case 'Printer Parts': return 'printer_parts_inventory' as const;
    default: return 'filament_inventory' as const;
  }
};

export const useMaterialInventory = () => {
  const [materials, setMaterials] = useState<MaterialInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const fetchMaterials = async () => {
    if (!tenant?.id) return;
    
    try {
      setLoading(true);
      const categories: InventoryType[] = ['Filament', 'Packaging', 'Components', 'Printer Parts'];
      const allMaterials: MaterialInventoryItem[] = [];

      for (const category of categories) {
        if (category === 'Filament') {
          const { data, error } = await supabase
            .from('filament_inventory')
            .select('*')
            .eq('tenant_id', tenant?.id)
            .order('created_at', { ascending: false });

          if (error) throw error;

          const categoryMaterials = (data || []).map(item => ({
            ...item,
            category,
            remaining: item.remaining_grams,
            usageHistory: []
          }));

          allMaterials.push(...categoryMaterials);
        } else if (category === 'Packaging') {
          const { data, error } = await supabase
            .from('packaging_inventory')
            .select('*')
            .eq('tenant_id', tenant?.id)
            .order('created_at', { ascending: false });

          if (error) throw error;

          const categoryMaterials = (data || []).map(item => ({
            ...item,
            color: '', // Set empty color since it was removed from table
            category,
            remaining: item.remaining_units,
            usageHistory: []
          }));

          allMaterials.push(...categoryMaterials);
        } else if (category === 'Components') {
          const { data, error } = await supabase
            .from('accessories_inventory')
            .select('*')
            .eq('tenant_id', tenant?.id)
            .order('created_at', { ascending: false });

          if (error) throw error;

          const categoryMaterials = (data || []).map(item => ({
            ...item,
            color: '', // Set empty color since it was removed from table
            category,
            remaining: item.remaining_units,
            usageHistory: []
          }));

          allMaterials.push(...categoryMaterials);
        } else if (category === 'Printer Parts') {
          const { data, error } = await supabase
            .from('printer_parts_inventory')
            .select('*')
            .eq('tenant_id', tenant?.id)
            .order('created_at', { ascending: false });

          if (error) throw error;

          const categoryMaterials = (data || []).map(item => ({
            ...item,
            color: '', // Set empty color since it was removed from table
            category,
            remaining: item.remaining_units,
            usageHistory: []
          }));

          allMaterials.push(...categoryMaterials);
        }
      }

      setMaterials(allMaterials);
    } catch (error: any) {
      console.error('Error fetching materials:', error);
      // Only show toast for unexpected errors, not for missing table/data scenarios
      if (error?.code !== 'PGRST116' && error?.code !== '42P01') {
        toast({
          title: "Error",
          description: "Failed to load materials from database.",
          variant: "destructive",
        });
      }
      // Set empty array for missing table scenarios
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
    try {
      const insertData: any = {
        type: materialData.type,
        brand: materialData.brand,
        location: materialData.location,
        cost_per_unit: materialData.cost_per_unit,
        low_threshold: materialData.low_threshold,
        reorder_link: materialData.reorder_link,
        tenant_id: tenant?.id,
        status: materialData.remaining === 0 ? 'out_of_stock' : 
                materialData.remaining <= (materialData.low_threshold || 100) ? 'low' : 'in_stock'
      };

      // Only add color for filament
      if (category === 'Filament') {
        insertData.color = materialData.color;
      }

      let data, error;

      if (category === 'Filament') {
        insertData.remaining_grams = materialData.remaining;

        const result = await supabase
          .from('filament_inventory')
          .insert(insertData)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Packaging') {
        insertData.remaining_units = materialData.remaining;
        // Remove color field for packaging
        delete insertData.color;
        
        const result = await supabase
          .from('packaging_inventory')
          .insert(insertData)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Components') {
        insertData.remaining_units = materialData.remaining;
        // Remove color field for components
        delete insertData.color;
        
        const result = await supabase
          .from('accessories_inventory')
          .insert(insertData)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Printer Parts') {
        insertData.remaining_units = materialData.remaining;
        // Remove color field for printer parts
        delete insertData.color;
        
        const result = await supabase
          .from('printer_parts_inventory')
          .insert(insertData)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      }

      if (error) throw error;

      const newMaterial: MaterialInventoryItem = {
        ...data,
        category,
        remaining: category === 'Filament' ? (data as any).remaining_grams : (data as any).remaining_units,
        usageHistory: []
      };

      setMaterials(prev => [newMaterial, ...prev]);
      toast({
        title: "Success",
        description: `${materialData.type} has been added to ${category} inventory.`,
      });

      return newMaterial;
    } catch (error) {
      console.error('Error adding material:', error);
      toast({
        title: "Error",
        description: "Failed to add material to database.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateMaterial = async (id: string, category: InventoryType, updates: Partial<MaterialInventoryItem>) => {
    try {
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

      let data, error;

      if (category === 'Filament') {
        const result = await supabase
          .from('filament_inventory')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Packaging') {
        const result = await supabase
          .from('packaging_inventory')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Components') {
        const result = await supabase
          .from('accessories_inventory')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      } else if (category === 'Printer Parts') {
        const result = await supabase
          .from('printer_parts_inventory')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      }

      if (error) throw error;

      const updatedMaterial: MaterialInventoryItem = {
        ...data,
        category,
        remaining: category === 'Filament' ? (data as any).remaining_grams : (data as any).remaining_units,
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
    } catch (error) {
      console.error('Error updating material:', error);
      toast({
        title: "Error",
        description: "Failed to update material.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteMaterial = async (id: string, category: InventoryType) => {
    try {
      let error;

      if (category === 'Filament') {
        const result = await supabase
          .from('filament_inventory')
          .delete()
          .eq('id', id);
        error = result.error;
      } else if (category === 'Packaging') {
        const result = await supabase
          .from('packaging_inventory')
          .delete()
          .eq('id', id);
        error = result.error;
      } else if (category === 'Components') {
        const result = await supabase
          .from('accessories_inventory')
          .delete()
          .eq('id', id);
        error = result.error;
      } else if (category === 'Printer Parts') {
        const result = await supabase
          .from('printer_parts_inventory')
          .delete()
          .eq('id', id);
        error = result.error;
      }

      if (error) throw error;

      setMaterials(prev => prev.filter(material => material.id !== id));
      toast({
        title: "Success",
        description: "Material deleted successfully.",
      });
    } catch (error) {
      console.error('Error deleting material:', error);
      toast({
        title: "Error",
        description: "Failed to delete material.",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    if (tenant?.id) {
      fetchMaterials();
    }
  }, [tenant?.id]);

  return {
    materials,
    loading,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    refetch: fetchMaterials
  };
};