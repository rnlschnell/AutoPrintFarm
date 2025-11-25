import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { api } from '@/lib/api-client';

export interface ProductInventoryItem {
  productId: string;
  productName: string;
  requiresAssembly: boolean;
  totalStock: number;
  totalAssembled: number;
  totalNeedsAssembly: number;
  totalValue: number;
  imageUrl?: string;
  skus: {
    id: string;
    skuId: string;
    sku: string;
    color: string;
    currentStock: number;
    quantityAssembled: number;
    quantityNeedsAssembly: number;
    unitPrice: number;
    assemblyStatus: 'printed' | 'needs_assembly' | 'assembled';
    status: string;
    material: string;
    lowStockThreshold: number;
  }[];
}

export const useProductInventory = () => {
  const [productInventory, setProductInventory] = useState<ProductInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant, isInitialized } = useTenant();
  const { toast } = useToast();

  const fetchProductInventory = useCallback(async () => {
    if (!tenant?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch products, SKUs, and finished goods in parallel using the api client
      // The api client automatically includes the X-Tenant-ID header
      const [products, skus, finishedGoods] = await Promise.all([
        api.get<any[]>('/api/v1/products'),
        api.get<any[]>('/api/v1/skus'),
        api.get<any[]>('/api/v1/inventory'),
      ]);

      // Transform data to group SKUs under products
      const transformedData: ProductInventoryItem[] = (products || []).map((product: any) => {
        // Find SKUs for this product
        const productSkus = skus.filter((sku: any) => sku.product_id === product.id);

        const transformedSkus = productSkus.map((sku: any) => {
          // Find finished good for this SKU
          const finishedGood = finishedGoods.find((fg: any) => fg.product_sku_id === sku.id);

          const quantityAssembled = finishedGood?.quantity_assembled || 0;
          const quantityNeedsAssembly = finishedGood?.quantity_needs_assembly || 0;
          const totalStock = quantityAssembled + quantityNeedsAssembly;

          return {
            id: finishedGood?.id || `sku-${sku.id}`,
            skuId: sku.id,
            sku: sku.sku,
            color: sku.color,
            currentStock: totalStock,
            quantityAssembled,
            quantityNeedsAssembly,
            unitPrice: sku.price || finishedGood?.unit_price || 0,
            assemblyStatus: (finishedGood?.assembly_status || 'printed') as 'printed' | 'needs_assembly' | 'assembled',
            status: finishedGood?.status || 'out_of_stock',
            material: finishedGood?.material || 'PLA',
            lowStockThreshold: finishedGood?.low_stock_threshold ?? 5
          };
        });

        const totalStock = transformedSkus.reduce((sum, sku) => sum + sku.currentStock, 0);
        const totalAssembled = transformedSkus.reduce((sum, sku) => sum + sku.quantityAssembled, 0);
        const totalNeedsAssembly = transformedSkus.reduce((sum, sku) => sum + sku.quantityNeedsAssembly, 0);
        const totalValue = transformedSkus.reduce((sum, sku) => sum + (sku.currentStock * sku.unitPrice), 0);

        return {
          productId: product.id,
          productName: product.name,
          requiresAssembly: product.requires_assembly,
          totalStock,
          totalAssembled,
          totalNeedsAssembly,
          totalValue,
          imageUrl: product.image_url,
          skus: transformedSkus
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
  }, [tenant?.id, toast]);

  const updateStock = async (finishedGoodId: string, newQuantity: number, assemblyType?: 'assembled' | 'needs_assembly') => {
    try {
      if (assemblyType) {
        // Update the specific assembly quantity field
        const updatePayload: Record<string, number> = assemblyType === 'assembled'
          ? { quantity_assembled: newQuantity }
          : { quantity_needs_assembly: newQuantity };

        await api.put(`/api/v1/inventory/${finishedGoodId}`, updatePayload);
      } else {
        // Use PUT to update total inventory
        await api.put(`/api/v1/inventory/${finishedGoodId}`, {
          current_stock: newQuantity,
        });
      }

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
    // Wait for auth to be fully initialized before making API calls
    // This prevents race conditions where tenant ID isn't set in the API client yet
    if (!isInitialized) {
      return;
    }
    fetchProductInventory();
  }, [fetchProductInventory, isInitialized]);

  const getFilteredInventory = (filter: 'all' | 'assembled' | 'needs_assembly') => {
    if (filter === 'all') return productInventory;
    return productInventory.map(product => ({
      ...product,
      skus: product.skus.filter(sku => {
        if (filter === 'assembled') return sku.quantityAssembled > 0;
        if (filter === 'needs_assembly') return sku.quantityNeedsAssembly > 0;
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
