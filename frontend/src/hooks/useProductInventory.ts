import { useState, useEffect } from 'react';
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

      // Fetch products from local SQLite API
      const productsResponse = await fetch('/api/products-sync/');
      if (!productsResponse.ok) throw new Error('Failed to fetch products');
      const products = await productsResponse.json();

      // Fetch product SKUs from local SQLite API
      const skusResponse = await fetch('/api/product-skus-sync/');
      if (!skusResponse.ok) throw new Error('Failed to fetch product SKUs');
      const skus = await skusResponse.json();

      // Fetch finished goods from local SQLite API
      const finishedGoodsResponse = await fetch('/api/finished-goods-sync/');
      if (!finishedGoodsResponse.ok) throw new Error('Failed to fetch finished goods');
      const finishedGoods = await finishedGoodsResponse.json();

      // Transform data to group SKUs under products
      const transformedData: ProductInventoryItem[] = (products || []).map((product: any) => {
        // Find SKUs for this product
        const productSkus = skus.filter((sku: any) => sku.product_id === product.id);

        const transformedSkus = productSkus.map((sku: any) => {
          // Find finished good for this SKU
          const finishedGood = finishedGoods.find((fg: any) => fg.product_sku_id === sku.id);

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

        const totalStock = transformedSkus.reduce((sum, sku) => sum + sku.currentStock, 0);
        const totalValue = transformedSkus.reduce((sum, sku) => sum + (sku.currentStock * sku.unitPrice), 0);

        return {
          productId: product.id,
          productName: product.name,
          requiresAssembly: product.requires_assembly,
          totalStock,
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
  };

  const updateStock = async (finishedGoodId: string, newStock: number) => {
    try {
      const response = await fetch(`/api/finished-goods-sync/${finishedGoodId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_stock: newStock,
          status: newStock === 0 ? 'out_of_stock' :
                  newStock < 5 ? 'low_stock' : 'in_stock'
        }),
      });

      if (!response.ok) throw new Error('Failed to update stock');

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