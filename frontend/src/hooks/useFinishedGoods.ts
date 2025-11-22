import { useState, useEffect } from 'react';
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
      // NOTE: Supabase calls removed - this hook is deprecated
      // Use useProductInventory instead which uses local /api/finished-goods-sync/
      console.warn('useFinishedGoods is deprecated - use useProductInventory instead');
      setFinishedGoods([]);
    } catch (error: any) {
      console.error('Error fetching finished goods:', error);
      setFinishedGoods([]);
    } finally {
      setLoading(false);
    }
  };

  const updateStock = async (id: string, newStock: number) => {
    // NOTE: Supabase calls removed - this hook is deprecated
    // Use useProductInventory instead which uses local /api/finished-goods-sync/
    console.warn('useFinishedGoods.updateStock is deprecated - use useProductInventory instead');
    toast({
      title: "Error",
      description: "This hook is deprecated. Please use useProductInventory.",
      variant: "destructive",
    });
  };

  const updateAssemblyStatus = async (id: string, status: FinishedGoodItem['assembly_status']) => {
    // NOTE: Supabase calls removed - this hook is deprecated
    // Use useProductInventory instead which uses local /api/finished-goods-sync/
    console.warn('useFinishedGoods.updateAssemblyStatus is deprecated - use useProductInventory instead');
    toast({
      title: "Error",
      description: "This hook is deprecated. Please use useProductInventory.",
      variant: "destructive",
    });
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