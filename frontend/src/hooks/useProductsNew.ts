import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { getApiBaseUrl } from '@/utils/apiUrl';

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
  const { tenant } = useTenant();
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
      
      // Fetch products from local-first API
      const productsResponse = await fetch('/api/products-sync/');
      if (!productsResponse.ok) {
        throw new Error(`Failed to fetch products: ${productsResponse.statusText}`);
      }
      const productsData = await productsResponse.json();
      console.log('Products fetched successfully:', productsData?.length || 0, 'products');
      
      // Fetch print files from local-first API  
      const printFilesResponse = await fetch('/api/print-files-sync/');
      if (!printFilesResponse.ok) {
        throw new Error(`Failed to fetch print files: ${printFilesResponse.statusText}`);
      }
      const printFilesData = await printFilesResponse.json();

      // Fetch SKUs from local-first API
      const skusResponse = await fetch('/api/product-skus-sync/');
      if (!skusResponse.ok) {
        throw new Error(`Failed to fetch product SKUs: ${skusResponse.statusText}`);
      }
      const skusData = await skusResponse.json();

      // Fetch components from Supabase
      const { data: componentsData, error: componentsError } = await supabase
        .from('product_components')
        .select('*')
        .eq('tenant_id', tenant.id);

      if (componentsError) {
        console.error('Error fetching components:', componentsError);
      }

      // Combine data from local-first APIs and Supabase
      const productsWithDetails: ProductWithDetails[] = (productsData || []).map(product => {
        // Find associated print file (legacy single file support)
        const printFile = printFilesData.find(file => file.id === product.print_file_id);

        // Find ALL print files for this product (multi-file support)
        const productPrintFiles = printFilesData.filter(file => file.product_id === product.id);

        // Find components for this product
        const productComponents = (componentsData || []).filter(c => c.product_id === product.id);

        return {
          ...product,
          skus: (skusData || []).filter(sku => sku.product_id === product.id),
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
      // Only show error toast for actual errors, not missing tables (empty tenant scenarios)
      if (error?.code !== 'PGRST116' && error?.code !== '42P01') {
        toast({
          title: "Error",
          description: "Failed to load products",
          variant: "destructive",
        });
      }
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

      // Create product via local-first API
      const productResponse = await fetch('/api/products-sync/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(productFields),
      });

      if (!productResponse.ok) {
        throw new Error(`Failed to create product: ${productResponse.statusText}`);
      }

      const productResult = await productResponse.json();

      if (!productResult.success) {
        throw new Error(productResult.message || 'Failed to create product');
      }

      const data = productResult.product;
      console.log('Product created successfully:', data);

      // Save components to Supabase if provided
      if (components && components.length > 0) {
        try {
          const componentInserts = components.map(comp => ({
            product_id: data.id,
            tenant_id: tenant.id,
            component_name: comp.component_name,
            accessory_id: comp.accessory_id,
            quantity_required: comp.quantity_required
          }));

          const { error } = await supabase
            .from('product_components')
            .insert(componentInserts);

          if (error) {
            console.error('Error saving components:', error);
            toast({
              title: "Warning",
              description: "Product created but components may not have saved",
              variant: "default",
            });
          } else {
            console.log(`Saved ${components.length} components for product ${data.id}`);
          }
        } catch (error) {
          console.error('Error saving components to Supabase:', error);
        }
      }

      // Save SKUs via local-first API if they exist
      if (skus && skus.length > 0) {
        for (const sku of skus) {
          try {
            const skuResponse = await fetch('/api/product-skus-sync/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                product_id: data.id,
                sku: sku.sku,
                color: sku.color,
                filament_type: sku.filament_type,
                hex_code: sku.hex_code,
                quantity: sku.quantity,
                stock_level: sku.stock_level || 0,
                price: sku.price,
                low_stock_threshold: sku.low_stock_threshold || 0
              }),
            });

            if (!skuResponse.ok) {
              throw new Error(`Failed to create SKU: ${skuResponse.statusText}`);
            }

            const skuResult = await skuResponse.json();
            if (!skuResult.success) {
              throw new Error(skuResult.message || 'Failed to create SKU');
            }
          } catch (error) {
            console.error('Error saving SKU:', error);
            // Don't throw here - product is already created
          }
        }
      }

      // Link ALL print files to this product
      // The print files were created during the temp file upload process
      // but weren't linked to a product yet (product didn't exist)
      if (uploaded_print_file_ids && uploaded_print_file_ids.length > 0) {
        console.log(`Linking ${uploaded_print_file_ids.length} print files to product ${data.id}`);

        for (const printFileId of uploaded_print_file_ids) {
          try {
            console.log(`Linking print file ${printFileId} to product ${data.id}`);
            const linkResponse = await fetch(`/api/print-files-sync/${printFileId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                product_id: data.id
              }),
            });

            if (!linkResponse.ok) {
              console.error(`Failed to link print file ${printFileId} to product:`, linkResponse.statusText);
              // Don't throw - product is already created, this is just a link
            } else {
              console.log(`Successfully linked print file ${printFileId} to product ${data.id}`);
            }
          } catch (error) {
            console.error(`Error linking print file ${printFileId} to product:`, error);
            // Don't throw - product is already created
          }
        }
      }

      toast({
        title: "Success",
        description: "Product added successfully",
      });

      await fetchProducts();
      return data;
    } catch (error) {
      console.error('Error adding product:', error);
      toast({
        title: "Error",
        description: "Failed to add product",
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

      console.log('Updating product:', {
        productId: id,
        uploaded_print_file_ids
      });

      // Update product via local-first API
      const productResponse = await fetch(`/api/products-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(productUpdates),
      });

      if (!productResponse.ok) {
        throw new Error(`Failed to update product: ${productResponse.statusText}`);
      }

      const productResult = await productResponse.json();

      if (!productResult.success) {
        throw new Error(productResult.message || 'Failed to update product');
      }

      const data = productResult.product;

      // Update components in Supabase if provided
      if (components !== undefined) {
        try {
          // Delete existing components
          await supabase
            .from('product_components')
            .delete()
            .eq('product_id', id);

          // Insert new components
          if (components.length > 0) {
            const componentInserts = components.map(comp => ({
              product_id: id,
              tenant_id: tenant.id,
              component_name: comp.component_name,
              accessory_id: comp.accessory_id,
              quantity_required: comp.quantity_required
            }));

            const { error } = await supabase
              .from('product_components')
              .insert(componentInserts);

            if (error) {
              console.error('Error updating components:', error);
              toast({
                title: "Warning",
                description: "Product updated but components may not have saved",
                variant: "default",
              });
            } else {
              console.log(`Updated components for product ${id}: ${components.length} components`);
            }
          } else {
            console.log(`Removed all components for product ${id}`);
          }
        } catch (error) {
          console.error('Error updating components in Supabase:', error);
        }
      }

      // Manage print files for this product (multi-file support)
      // This handles both linking new files and unlinking removed files
      if (uploaded_print_file_ids !== undefined) {
        // Fetch current print files for this product to detect removals
        try {
          const printFilesResponse = await fetch('/api/print-files-sync/');
          if (printFilesResponse.ok) {
            const allPrintFiles = await printFilesResponse.json();
            const currentProductFiles = allPrintFiles.filter(pf => pf.product_id === id);

            // Find files that need to be unlinked (exist in current but not in new list)
            const filesToUnlink = currentProductFiles.filter(
              pf => !uploaded_print_file_ids.includes(pf.id)
            );

            // Unlink removed files by setting product_id to null
            if (filesToUnlink.length > 0) {
              console.log(`Unlinking ${filesToUnlink.length} removed print files from product ${id}`);

              for (const fileToUnlink of filesToUnlink) {
                try {
                  console.log(`Unlinking print file ${fileToUnlink.id} from product ${id}`);
                  const unlinkResponse = await fetch(`/api/print-files-sync/${fileToUnlink.id}`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      product_id: null
                    }),
                  });

                  if (!unlinkResponse.ok) {
                    console.error(`Failed to unlink print file ${fileToUnlink.id}:`, unlinkResponse.statusText);
                  } else {
                    console.log(`Successfully unlinked print file ${fileToUnlink.id} from product ${id}`);
                  }
                } catch (error) {
                  console.error(`Error unlinking print file ${fileToUnlink.id}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error fetching current print files:', error);
        }

        // Link new/kept print files to this product
        if (uploaded_print_file_ids.length > 0) {
          console.log(`Linking ${uploaded_print_file_ids.length} print files to product ${id}`);

          for (const printFileId of uploaded_print_file_ids) {
            try {
              console.log(`Linking print file ${printFileId} to product ${id}`);
              const linkResponse = await fetch(`/api/print-files-sync/${printFileId}`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  product_id: id
                }),
              });

              if (!linkResponse.ok) {
                console.error(`Failed to link print file ${printFileId} to product:`, linkResponse.statusText);
                // Don't throw - product is already updated, this is just a link
              } else {
                console.log(`Successfully linked print file ${printFileId} to product ${id}`);
              }
            } catch (error) {
              console.error(`Error linking print file ${printFileId} to product:`, error);
              // Don't throw - product is already updated
            }
          }
        }
      }

      // Handle SKUs - simplified approach for product edit
      if (skus !== null && skus !== undefined && Array.isArray(skus)) {
        console.log('Updating SKUs for product:', id, skus);
        
        // Get current SKUs from local database
        const response = await fetch(`/api/product-skus-sync/product/${id}`);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Error fetching current SKUs:', errorText);
          throw new Error(`Failed to fetch current SKUs: ${response.status} ${errorText}`);
        }
        const currentSkus = await response.json();
        
        // Create maps for easier comparison
        const currentSkusMap = new Map();
        currentSkus?.forEach(sku => {
          currentSkusMap.set(sku.id, sku);
        });
        
        const newSkusMap = new Map();
        const skusToInsert = [];
        const skusToUpdate = [];
        
        // Process incoming SKUs
        skus.forEach(sku => {
          console.log('🔍 Processing SKU:', { id: sku.id, sku: sku.sku, price: sku.price, priceType: typeof sku.price });

          if (sku.id && sku.id.startsWith('temp-')) {
            // This is a new SKU (temp ID)
            const newSkuData = {
              product_id: id,
              sku: sku.sku,
              color: sku.color,
              filament_type: sku.filament_type,
              hex_code: sku.hex_code,
              quantity: sku.quantity,
              stock_level: sku.stock_level || 0,
              price: sku.price,
              low_stock_threshold: sku.low_stock_threshold || 0,
              tenant_id: tenant?.id
            };
            console.log('✅ New SKU (temp ID) - Adding to skusToInsert:', newSkuData);
            skusToInsert.push(newSkuData);
          } else if (sku.id && currentSkusMap.has(sku.id)) {
            // This is an existing SKU that might need updates
            const currentSku = currentSkusMap.get(sku.id);
            newSkusMap.set(sku.id, sku);
            
            // Check if any fields have changed
            // Note: Both currentSku.price and sku.price are in dollars (API converts from cents)
            // Use tolerance for floating point comparison to avoid false positives
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
        
        // Find SKUs that were deleted (exist in current but not in new)
        const skusToDelete = [];
        currentSkus?.forEach(currentSku => {
          if (!newSkusMap.has(currentSku.id) && !skus.some(s => s.id === currentSku.id)) {
            skusToDelete.push(currentSku.id);
          }
        });
        
        // Execute the changes
        
        // 1. Insert new SKUs
        if (skusToInsert.length > 0) {
          console.log('📤 About to INSERT new SKUs:', skusToInsert);
          for (const sku of skusToInsert) {
            console.log('📤 Sending SKU to API:', sku, 'JSON:', JSON.stringify(sku));
            const response = await fetch('/api/product-skus-sync/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(sku)
            });

            if (!response.ok) {
              // Try to parse JSON error response
              const errorData = await response.json().catch(() => ({}));
              const errorMessage = errorData.detail || `Failed to insert SKU: ${response.statusText}`;
              console.error('Error inserting new SKU:', errorMessage);
              throw new Error(errorMessage);
            }
          }
        }
        
        // 2. Update existing SKUs
        for (const skuUpdate of skusToUpdate) {
          const { id, ...updateFields } = skuUpdate;
          const response = await fetch(`/api/product-skus-sync/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateFields)
          });

          if (!response.ok) {
            // Try to parse JSON error response
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.detail || `Failed to update SKU: ${response.statusText}`;
            console.error('Error updating SKU:', errorMessage);
            throw new Error(errorMessage);
          }
        }
        
        // 3. Hard delete removed SKUs
        if (skusToDelete.length > 0) {
          for (const skuId of skusToDelete) {
            const response = await fetch(`/api/product-skus-sync/${skuId}`, {
              method: 'DELETE'
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('Error deleting SKU:', errorText);
              throw new Error(`Failed to delete SKU: ${response.status} ${errorText}`);
            }
          }
        }
        
        console.log('SKU operations completed:', {
          inserted: skusToInsert.length,
          updated: skusToUpdate.length,
          deleted: skusToDelete.length
        });
      } else {
        console.log('No SKUs to update - preserving existing SKUs for product:', id);
      }

      toast({
        title: "Success",
        description: "Product updated successfully",
      });

      await fetchProducts();
      return data;
    } catch (error) {
      console.error('Error updating product:', error);
      toast({
        title: "Error",
        description: "Failed to update product",
        variant: "destructive",
      });
      throw error; // Re-throw to let the modal handle it
    }
  }, [tenant?.id, toast, fetchProducts, products]);

  const deleteProduct = useCallback(async (id: string) => {
    try {
      // First get the product from local state to find the print_file_id
      const product = products.find(p => p.id === id);
      
      // Delete the product via local-first API (SKUs will be cascade deleted automatically)
      const deleteResponse = await fetch(`/api/products-sync/${id}`, {
        method: 'DELETE',
      });

      if (!deleteResponse.ok) {
        throw new Error(`Failed to delete product: ${deleteResponse.statusText}`);
      }
      
      const result = await deleteResponse.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to delete product');
      }

      // Delete components from Supabase
      try {
        await supabase
          .from('product_components')
          .delete()
          .eq('product_id', id);
        console.log(`Deleted components for product ${id}`);
      } catch (error) {
        console.error('Error deleting components from Supabase:', error);
      }

      // Delete the associated print file if it exists
      if (product?.print_file_id) {
        try {
          const printFileResponse = await fetch(`/api/print-files-sync/${product.print_file_id}`, {
            method: 'DELETE',
          });

          if (!printFileResponse.ok || !(await printFileResponse.json()).success) {
            console.warn('Failed to delete associated print file via API');
            // Don't fail the whole operation if print file deletion fails
          }
        } catch (error) {
          console.warn('Failed to delete associated print file:', error);
        }
      }

      // Trigger cleanup of orphaned files on Pi
      try {
        const baseUrl = getApiBaseUrl();

        const cleanupResponse = await fetch(`${baseUrl}/api/available-files/maintenance/cleanup-orphaned`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (cleanupResponse.ok) {
          const cleanupData = await cleanupResponse.json();
          console.log('Cleanup successful:', cleanupData);
        } else {
          console.warn('Failed to trigger cleanup:', cleanupResponse.status);
        }
      } catch (cleanupError) {
        console.warn('Error triggering cleanup:', cleanupError);
        // Don't fail the main operation if cleanup fails
      }

      toast({
        title: "Success",
        description: "Product, associated SKUs, and print file deleted successfully",
      });

      await fetchProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive",
      });
    }
  }, [toast, fetchProducts]);

  const addSku = useCallback(async (skuData: Omit<ProductSku, 'id' | 'created_at' | 'updated_at'>) => {
    console.log('addSku called with:', skuData);
    try {
      // Create SKU via local-first API
      const skuResponse = await fetch('/api/product-skus-sync/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(skuData),
      });

      if (!skuResponse.ok) {
        // Try to extract error detail from response
        const errorData = await skuResponse.json().catch(() => ({}));
        const errorMessage = errorData.detail || `Failed to create SKU: ${skuResponse.statusText}`;
        throw new Error(errorMessage);
      }

      const skuResult = await skuResponse.json();

      if (!skuResult.success) {
        throw new Error(skuResult.message || 'Failed to create SKU');
      }

      console.log('addSku successful, data:', skuResult);

      toast({
        title: "Success",
        description: "SKU added successfully",
      });

      await fetchProducts();
      return skuResult.sku;
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
      // Update SKU via local-first API
      const skuResponse = await fetch(`/api/product-skus-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!skuResponse.ok) {
        // Try to extract error detail from response
        const errorData = await skuResponse.json().catch(() => ({}));
        const errorMessage = errorData.detail || `Failed to update SKU: ${skuResponse.statusText}`;
        throw new Error(errorMessage);
      }

      const skuResult = await skuResponse.json();

      if (!skuResult.success) {
        throw new Error(skuResult.message || 'Failed to update SKU');
      }

      console.log('updateSku successful, data:', skuResult);
      toast({
        title: "Success",
        description: "SKU updated successfully",
      });

      await fetchProducts();
      return skuResult.sku;
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
      // Delete SKU via local-first API
      const skuResponse = await fetch(`/api/product-skus-sync/${id}`, {
        method: 'DELETE',
      });

      if (!skuResponse.ok) {
        throw new Error(`Failed to delete SKU: ${skuResponse.statusText}`);
      }

      const skuResult = await skuResponse.json();

      if (!skuResult.success) {
        throw new Error(skuResult.message || 'Failed to delete SKU');
      }

      console.log('deleteSku successful:', skuResult);

      toast({
        title: "Success",
        description: "SKU deleted successfully",
      });

      await fetchProducts();
    } catch (error) {
      console.error('Error deleting SKU:', error);
      toast({
        title: "Error",
        description: "Failed to delete SKU",
        variant: "destructive",
      });
    }
  }, [toast, fetchProducts]);

  // Note: addComponent and deleteComponent removed (table no longer exists in Supabase)

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
