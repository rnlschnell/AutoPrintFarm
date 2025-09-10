import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';

export interface FinishedGoodItem {
  id: string;
  tenant_id: string;
  product_sku_id?: string;
  sku: string;
  color: string;
  material: string;
  current_stock: number;
  assembly_status: 'printed' | 'needs_assembly' | 'assembled';
  print_job_id?: string;
  unit_price: number;
  status?: string;
  created_at: string;
  updated_at: string;
  // Relations
  product_sku?: {
    id: string;
    sku: string;
    color: string;
    product: {
      id: string;
      name: string;
      requires_assembly: boolean;
    };
  };
  print_job?: {
    id: string;
    file_name: string;
    status: string;
  };
}

export const useFinishedGoods = () => {
  const [finishedGoods, setFinishedGoods] = useState<FinishedGoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useTenant();
  const { toast } = useToast();

  const fetchFinishedGoods = async () => {
    if (!tenant?.id) return;
    
    try {
      setLoading(true);
      // Fetch all product SKUs with their finished goods data
      const { data, error } = await supabase
        .from('product_skus')
        .select(`
          *,
          product:products (
            id,
            name,
            requires_assembly
          ),
          finished_goods (
            id,
            current_stock,
            unit_price,
            assembly_status,
            status,
            material,
            print_job_id
          )
        `)
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform data to show all SKUs, even without finished goods
      const transformedData = (data || []).map(item => {
        const finishedGood = item.finished_goods?.[0];
        return {
          id: finishedGood?.id || `sku-${item.id}`,
          tenant_id: tenant?.id || '',
          product_sku_id: item.id,
          sku: item.sku,
          color: item.color,
          material: finishedGood?.material || 'PLA',
          current_stock: finishedGood?.current_stock || 0,
          assembly_status: (finishedGood?.assembly_status || 'printed') as FinishedGoodItem['assembly_status'],
          print_job_id: finishedGood?.print_job_id,
          unit_price: finishedGood?.unit_price || item.price || 0,
          status: finishedGood?.status || 'out_of_stock',
          created_at: item.created_at,
          updated_at: item.updated_at,
          product_sku: {
            id: item.id,
            sku: item.sku,
            color: item.color,
            product: item.product
          }
        };
      });
      
      setFinishedGoods(transformedData as FinishedGoodItem[]);
    } catch (error: any) {
      console.error('Error fetching finished goods:', error);
      if (error?.code !== 'PGRST116' && error?.code !== '42P01') {
        toast({
          title: "Error",
          description: "Failed to load finished goods",
          variant: "destructive",
        });
      }
      setFinishedGoods([]);
    } finally {
      setLoading(false);
    }
  };

  const updateStock = async (id: string, newStock: number) => {
    try {
      const { error } = await supabase
        .from('finished_goods')
        .update({ 
          current_stock: newStock,
          status: newStock === 0 ? 'out_of_stock' : 
                  newStock < 5 ? 'low_stock' : 'in_stock'
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Stock updated successfully",
      });

      await fetchFinishedGoods();
    } catch (error) {
      console.error('Error updating stock:', error);
      toast({
        title: "Error",
        description: "Failed to update stock",
        variant: "destructive",
      });
    }
  };

  const updateAssemblyStatus = async (id: string, status: FinishedGoodItem['assembly_status']) => {
    try {
      const { error } = await supabase
        .from('finished_goods')
        .update({ assembly_status: status })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Assembly status updated to ${status}`,
      });

      await fetchFinishedGoods();
    } catch (error) {
      console.error('Error updating assembly status:', error);
      toast({
        title: "Error",
        description: "Failed to update assembly status",
        variant: "destructive",
      });
    }
  };

  // Filter functions for different views
  const getByAssemblyStatus = (status: FinishedGoodItem['assembly_status']) => {
    return finishedGoods.filter(item => item.assembly_status === status);
  };

  const getAssembledItems = () => getByAssemblyStatus('assembled');
  const getNeedsAssemblyItems = () => getByAssemblyStatus('needs_assembly');
  const getPrintedItems = () => getByAssemblyStatus('printed');

  useEffect(() => {
    if (tenant?.id) {
      fetchFinishedGoods();
    }
  }, [tenant?.id]);

  return {
    finishedGoods,
    loading,
    updateStock,
    updateAssemblyStatus,
    getAssembledItems,
    getNeedsAssemblyItems,
    getPrintedItems,
    refetch: fetchFinishedGoods
  };
};