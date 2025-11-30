import { useState, useEffect, useCallback } from 'react';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  category?: string;
  print_file_id?: string;
  file_name?: string;
  requires_assembly: boolean;
  requires_post_processing: boolean;
  printer_priority?: string | null;
  image_url?: string;
  is_active: boolean;
  wiki_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductSku {
  id: string;
  product_id: string;
  sku: string;
  color: string;
  filament_type?: string;
  hex_code?: string;
  quantity: number;
  stock_level: number;
  price?: number;
  low_stock_threshold?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  finishedGoodsStock?: number;
}

export interface ProductComponent {
  id: string;
  product_id: string;
  component_name: string;
  accessory_id?: string;
  component_type?: string;
  quantity_required: number;
  notes?: string;
  created_at: string;
}

export interface ProductWithDetails extends Product {
  skus: ProductSku[];
  components: ProductComponent[];
  print_file?: {
    id: string;
    name: string;
  };
  print_files?: Array<{
    id: string;
    name: string;
    printer_model_id?: string | null;
    file_name?: string;
  }>;
}

export const useProductsNew = () => {
  const [products, setProducts] = useState<ProductWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant, isInitialized } = useTenant();
  const { toast } = useToast();

  const fetchProducts = useCallback(async () => {
    if (!tenant?.id) {
      console.log('No tenant ID available, setting loading to false');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('Fetching products for tenant:', tenant?.id);

      // Fetch products, files, SKUs, and components in parallel using the api client
      const [productsData, printFilesData, skusData, componentsData] = await Promise.all([
        api.get<any[]>('/api/v1/products'),
        api.get<any[]>('/api/v1/files'),
        api.get<any[]>('/api/v1/skus'),
        api.get<any[]>('/api/v1/products/components/all'),
      ]);

      console.log('Products fetched successfully:', productsData?.length || 0, 'products');

      // Combine data from cloud APIs
      const productsWithDetails: ProductWithDetails[] = (productsData || []).map(product => {
        // Find associated print file (legacy single file support)
        const printFile = (printFilesData || []).find(file => file.id === product.print_file_id);

        // Find ALL print files for this product (multi-file support)
        const productPrintFiles = (printFilesData || []).filter(file => file.product_id === product.id);

        // Filter and map SKUs for this product, including finished_goods_stock
        const productSkus = (skusData || [])
          .filter(sku => sku.product_id === product.id)
          .map(sku => ({
            ...sku,
            finishedGoodsStock: sku.finished_goods_stock || 0, // Map snake_case to camelCase
          }));

        // Filter components for this product
        const productComponents = (componentsData || []).filter(
          (comp: any) => comp.product_id === product.id
        );

        return {
          ...product,
          skus: productSkus,
          components: productComponents,
          print_file: printFile ? { id: printFile.id, name: printFile.name } : null,
          print_files: productPrintFiles.map(pf => ({
            id: pf.id,
            name: pf.name,
            printer_model_id: pf.printer_model_id,
            file_name: pf.name
          }))
        };
      });

      console.log('Final products with details:', productsWithDetails.length);
      setProducts(productsWithDetails);
    } catch (error: any) {
      console.error('Error fetching products:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to load products",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, toast]);

  const addProduct = useCallback(async (productData: Omit<Product, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> & {
    components?: any[];
    skus?: any[];
    uploaded_print_file_ids?: string[];
  }) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "No tenant context available",
        variant: "destructive",
      });
      return;
    }

    try {
      // Extract components, skus, and uploaded_print_file_ids from productData
      const { components, skus, uploaded_print_file_ids, ...productFields } = productData;

      console.log('Adding product with data:', productFields);

      // Create product via cloud API
      const data = await api.post<Product>('/api/v1/products', productFields);
      console.log('Product created successfully:', data);

      // Save SKUs via cloud API if they exist
      if (skus && skus.length > 0) {
        for (const sku of skus) {
          try {
            await api.post(`/api/v1/products/${data.id}/skus`, {
              sku: sku.sku,
              color: sku.color,
              filament_type: sku.filament_type,
              hex_code: sku.hex_code,
              quantity: sku.quantity,
              stock_level: sku.stock_level || 0,
              price: sku.price,
              low_stock_threshold: sku.low_stock_threshold || 0
            });
          } catch (error) {
            console.error('Error saving SKU:', error);
            // Don't throw here - product is already created
          }
        }
      }

      // Link ALL print files to this product
      if (uploaded_print_file_ids && uploaded_print_file_ids.length > 0) {
        console.log(`Linking ${uploaded_print_file_ids.length} print files to product ${data.id}`);

        for (const printFileId of uploaded_print_file_ids) {
          try {
            console.log(`Linking print file ${printFileId} to product ${data.id}`);
            await api.put(`/api/v1/files/${printFileId}`, { product_id: data.id });
            console.log(`Successfully linked print file ${printFileId} to product ${data.id}`);
          } catch (error) {
            console.error(`Error linking print file ${printFileId} to product:`, error);
            // Don't throw - product is already created
          }
        }
      }

      // Save assembly components if they exist
      if (components && components.length > 0) {
        try {
          console.log(`Saving ${components.length} assembly components for product ${data.id}`);
          await api.post(`/api/v1/products/${data.id}/components`, {
            components: components.map(c => ({
              component_name: c.component_name,
              component_type: c.component_type,
              quantity_required: c.quantity_required,
              notes: c.notes
            })),
            replace: true
          });
          console.log(`Successfully saved assembly components for product ${data.id}`);
        } catch (error) {
          console.error('Error saving assembly components:', error);
          // Don't throw - product is already created
        }
      }

      toast({
        title: "Success",
        description: "Product added successfully",
      });

      await fetchProducts();
      return data;
    } catch (error: any) {
      console.error('Error adding product:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to add product",
        variant: "destructive",
      });
    }
  }, [tenant?.id, toast, fetchProducts]);

  const updateProduct = useCallback(async (id: string, updates: Partial<Product> & {
    components?: any[];
    skus?: any[];
    uploaded_print_file_ids?: string[];
  }) => {
    try {
      // Extract components, skus, and uploaded_print_file_ids from updates
      const { components, skus, uploaded_print_file_ids, ...productUpdates } = updates;

      console.log('Updating product:', { productId: id, uploaded_print_file_ids });

      // Update product via cloud API
      const data = await api.put<Product>(`/api/v1/products/${id}`, productUpdates);

      // Manage print files for this product (multi-file support)
      if (uploaded_print_file_ids !== undefined) {
        try {
          const currentProductFiles = await api.get<any[]>('/api/v1/files', { params: { product_id: id } }) || [];

          // Unlink removed files
          const filesToUnlink = currentProductFiles.filter(pf => !uploaded_print_file_ids.includes(pf.id));
          for (const fileToUnlink of filesToUnlink) {
            try {
              await api.put(`/api/v1/files/${fileToUnlink.id}`, { product_id: null });
              console.log(`Unlinked print file ${fileToUnlink.id} from product ${id}`);
            } catch (error) {
              console.error(`Error unlinking print file ${fileToUnlink.id}:`, error);
            }
          }

          // Link new/kept print files
          for (const printFileId of uploaded_print_file_ids) {
            try {
              await api.put(`/api/v1/files/${printFileId}`, { product_id: id });
              console.log(`Linked print file ${printFileId} to product ${id}`);
            } catch (error) {
              console.error(`Error linking print file ${printFileId}:`, error);
            }
          }
        } catch (error) {
          console.error('Error managing print files:', error);
        }
      }

      // Handle SKUs
      if (skus !== null && skus !== undefined && Array.isArray(skus)) {
        console.log('Updating SKUs for product:', id, 'skus passed in:', skus);

        const currentSkus = await api.get<any[]>('/api/v1/skus', { params: { product_id: id } }) || [];
        console.log('Current SKUs from DB:', currentSkus, 'colors:', currentSkus.map(s => s.color));
        const currentSkusMap = new Map(currentSkus.map(sku => [sku.id, sku]));
        const newSkusMap = new Map<string, any>();
        const skusToInsert: any[] = [];
        const skusToUpdate: any[] = [];

        skus.forEach(sku => {
          if (sku.id?.startsWith('temp-')) {
            skusToInsert.push({
              sku: sku.sku,
              color: sku.color,
              filament_type: sku.filament_type,
              hex_code: sku.hex_code,
              quantity: sku.quantity,
              stock_level: sku.stock_level || 0,
              price: sku.price,
              low_stock_threshold: sku.low_stock_threshold || 0
            });
          } else if (sku.id && currentSkusMap.has(sku.id)) {
            const currentSku = currentSkusMap.get(sku.id);
            newSkusMap.set(sku.id, sku);

            const hasChanges = (
              currentSku.sku !== sku.sku ||
              currentSku.color !== sku.color ||
              currentSku.filament_type !== sku.filament_type ||
              currentSku.hex_code !== sku.hex_code ||
              currentSku.quantity !== sku.quantity ||
              currentSku.stock_level !== sku.stock_level ||
              Math.abs((currentSku.price || 0) - (sku.price || 0)) > 0.001 ||
              (currentSku.low_stock_threshold || 0) !== (sku.low_stock_threshold || 0)
            );

            if (hasChanges) {
              skusToUpdate.push({
                id: sku.id,
                sku: sku.sku,
                color: sku.color,
                filament_type: sku.filament_type,
                hex_code: sku.hex_code,
                quantity: sku.quantity,
                stock_level: sku.stock_level || 0,
                price: sku.price,
                low_stock_threshold: sku.low_stock_threshold || 0
              });
            }
          }
        });

        const skusToDelete = currentSkus.filter(
          cs => !newSkusMap.has(cs.id) && !skus.some(s => s.id === cs.id)
        ).map(s => s.id);

        // Insert new SKUs
        for (const skuBody of skusToInsert) {
          await api.post(`/api/v1/products/${id}/skus`, skuBody);
        }

        // Update existing SKUs
        for (const { id: skuId, ...updateFields } of skusToUpdate) {
          await api.put(`/api/v1/skus/${skuId}`, updateFields);
        }

        // Delete removed SKUs
        for (const skuId of skusToDelete) {
          await api.delete(`/api/v1/skus/${skuId}`);
        }

        console.log('SKU operations completed:', {
          inserted: skusToInsert.length,
          updated: skusToUpdate.length,
          deleted: skusToDelete.length
        });
      }

      // Handle assembly components
      if (components !== undefined) {
        try {
          if (components.length > 0) {
            // Replace all components with new ones
            console.log(`Saving ${components.length} assembly components for product ${id}`);
            await api.post(`/api/v1/products/${id}/components`, {
              components: components.map(c => ({
                component_name: c.component_name,
                component_type: c.component_type,
                quantity_required: c.quantity_required,
                notes: c.notes
              })),
              replace: true
            });
            console.log(`Successfully saved assembly components for product ${id}`);
          } else {
            // Delete all components if array is empty
            console.log(`Deleting all assembly components for product ${id}`);
            await api.delete(`/api/v1/products/${id}/components`);
            console.log(`Successfully deleted assembly components for product ${id}`);
          }
        } catch (error) {
          console.error('Error saving assembly components:', error);
          // Don't throw - product update already succeeded
        }
      }

      toast({
        title: "Success",
        description: "Product updated successfully",
      });

      await fetchProducts();
      return data;
    } catch (error: any) {
      console.error('Error updating product:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update product",
        variant: "destructive",
      });
      throw error;
    }
  }, [tenant?.id, toast, fetchProducts, products]);

  const deleteProduct = useCallback(async (id: string) => {
    try {
      const product = products.find(p => p.id === id);

      // Delete the product via cloud API (SKUs will be cascade deleted automatically)
      await api.delete(`/api/v1/products/${id}`);

      // Delete the associated print file if it exists
      if (product?.print_file_id) {
        try {
          await api.delete(`/api/v1/files/${product.print_file_id}`);
        } catch (error) {
          console.warn('Failed to delete associated print file:', error);
        }
      }

      toast({
        title: "Success",
        description: "Product, associated SKUs, and print file deleted successfully",
      });

      await fetchProducts();
    } catch (error: any) {
      console.error('Error deleting product:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to delete product",
        variant: "destructive",
      });
    }
  }, [toast, fetchProducts, products]);

  const addSku = useCallback(async (skuData: Omit<ProductSku, 'id' | 'created_at' | 'updated_at'>) => {
    console.log('addSku called with:', skuData);
    try {
      const { product_id, ...skuBody } = skuData;
      const result = await api.post<ProductSku>(`/api/v1/products/${product_id}/skus`, skuBody);

      toast({
        title: "Success",
        description: "SKU added successfully",
      });

      await fetchProducts();
      return result;
    } catch (error: any) {
      console.error('Error adding SKU:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to add SKU",
        variant: "destructive",
      });
      throw error;
    }
  }, [toast, fetchProducts]);

  const updateSku = useCallback(async (id: string, updates: Partial<ProductSku>) => {
    console.log('updateSku called with:', id, updates);
    try {
      const result = await api.put<ProductSku>(`/api/v1/skus/${id}`, updates);

      toast({
        title: "Success",
        description: "SKU updated successfully",
      });

      await fetchProducts();
      return result;
    } catch (error: any) {
      console.error('Error updating SKU:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update SKU",
        variant: "destructive",
      });
      throw error;
    }
  }, [toast, fetchProducts]);

  const deleteSku = useCallback(async (id: string) => {
    try {
      await api.delete(`/api/v1/skus/${id}`);

      toast({
        title: "Success",
        description: "SKU deleted successfully",
      });

      await fetchProducts();
    } catch (error: any) {
      console.error('Error deleting SKU:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to delete SKU",
        variant: "destructive",
      });
    }
  }, [toast, fetchProducts]);

  // Note: addComponent and deleteComponent removed (table no longer exists in Supabase)

  useEffect(() => {
    // Wait for auth to be fully initialized before making API calls
    // This prevents race conditions where tenant ID isn't set in the API client yet
    if (!isInitialized) {
      return;
    }
    fetchProducts();
  }, [fetchProducts, isInitialized]);

  return {
    products,
    loading,
    addProduct,
    updateProduct,
    deleteProduct,
    addSku,
    updateSku,
    deleteSku,
    refetch: fetchProducts,
  };
};
