import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';

export interface ProductInventoryItem {
  productId: string;
  productName: string;
  requiresAssembly: boolean;
  totalStock: number;
  totalValue: number;
  imageUrl?: string;
  skus: {
    id: string;
    skuId: string;
    sku: string;
    color: string;
    currentStock: number;
    unitPrice: number;
    assemblyStatus: 'printed' | 'needs_assembly' | 'assembled';
    status: string;
    material: string;
  }[];
}

export const useProductInventory = () => {
  const [productInventory, setProductInventory] = useState<ProductInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useTenant();
  const { toast } = useToast();

  const fetchProductInventory = async () => {
    if (!tenant?.id) return;
    
    try {
      setLoading(true);
      
      // Fetch products with their SKUs and finished goods (now using current_stock from finished_goods)
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          name,
          requires_assembly,
          image_url,
          product_skus!inner (
            id,
            sku,
            color,
            price,
            finished_goods (
              id,
              current_stock,
              unit_price,
              assembly_status,
              status,
              material
            )
          )
        `)
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true)
        .eq('product_skus.is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform data to group SKUs under products
      const transformedData: ProductInventoryItem[] = (data || []).map(product => {
        const skus = product.product_skus.map(sku => {
          const finishedGood = sku.finished_goods?.[0];
          return {
            id: finishedGood?.id || `sku-${sku.id}`,
            skuId: sku.id,
            sku: sku.sku,
            color: sku.color,
            currentStock: finishedGood?.current_stock || 0,
            unitPrice: finishedGood?.unit_price || sku.price || 0,
            assemblyStatus: (finishedGood?.assembly_status || 'printed') as 'printed' | 'needs_assembly' | 'assembled',
            status: finishedGood?.status || 'out_of_stock',
            material: finishedGood?.material || 'PLA'
          };
        });

        const totalStock = skus.reduce((sum, sku) => sum + sku.currentStock, 0);
        const totalValue = skus.reduce((sum, sku) => sum + (sku.currentStock * sku.unitPrice), 0);

        return {
          productId: product.id,
          productName: product.name,
          requiresAssembly: product.requires_assembly,
          totalStock,
          totalValue,
          imageUrl: product.image_url,
          skus
        };
      });
      
      setProductInventory(transformedData);
    } catch (error: any) {
      console.error('Error fetching product inventory:', error);
      toast({
        title: "Error",
        description: "Failed to load product inventory",
        variant: "destructive",
      });
      setProductInventory([]);
    } finally {
      setLoading(false);
    }
  };

  const updateStock = async (finishedGoodId: string, newStock: number) => {
    try {
      const { error } = await supabase
        .from('finished_goods')
        .update({ 
          current_stock: newStock,
          status: newStock === 0 ? 'out_of_stock' : 
                  newStock < 5 ? 'low_stock' : 'in_stock'
        })
        .eq('id', finishedGoodId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Stock updated successfully",
      });

      await fetchProductInventory();
    } catch (error) {
      console.error('Error updating stock:', error);
      toast({
        title: "Error",
        description: "Failed to update stock",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (tenant?.id) {
      fetchProductInventory();
    }
  }, [tenant?.id]);

  const getFilteredInventory = (filter: 'all' | 'assembled' | 'needs_assembly') => {
    if (filter === 'all') return productInventory;
    return productInventory.map(product => ({
      ...product,
      skus: product.skus.filter(sku => {
        if (filter === 'assembled') return sku.assemblyStatus === 'assembled';
        if (filter === 'needs_assembly') return sku.assemblyStatus === 'needs_assembly';
        return true;
      })
    })).filter(product => product.skus.length > 0);
  };

  return {
    productInventory,
    loading,
    updateStock,
    refetch: fetchProductInventory,
    getFilteredInventory
  };
};