import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  category?: string;
  print_file_id?: string;
  file_name?: string;
  requires_assembly: boolean;
  image_url?: string;
  is_active: boolean;
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductComponent {
  id: string;
  product_id: string;
  component_name: string;
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
      
      // Fetch products with print file info
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select(`
          *,
          print_files (
            id,
            name
          )
        `)
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (productsError) {
        console.error('Products fetch error:', productsError);
        throw productsError;
      }

      console.log('Products fetched successfully:', productsData?.length || 0, 'products');

      // Fetch all SKUs and components for this tenant
      const { data: skusData, error: skusError } = await supabase
        .from('product_skus')
        .select('*')
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true);

      const { data: componentsData, error: componentsError } = await supabase
        .from('product_components')
        .select('*')
        .eq('tenant_id', tenant?.id);

      if (skusError) throw skusError;
      if (componentsError) throw componentsError;

      // Combine data
      const productsWithDetails: ProductWithDetails[] = (productsData || []).map(product => ({
        ...product,
        skus: (skusData || []).filter(sku => sku.product_id === product.id),
        components: (componentsData || []).filter(component => component.product_id === product.id),
        print_file: product.print_files?.[0] || null
      }));

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

  // Set up real-time subscription for stock changes and SKU changes
  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel('product-stock-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'product_skus',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Product SKU stock updated:', payload);
          // Refetch products when stock changes
          fetchProducts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'product_skus',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Product SKU inserted:', payload);
          // Refetch products when new SKUs are added
          fetchProducts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'product_skus',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Product SKU deleted:', payload);
          // Refetch products when SKUs are deleted
          fetchProducts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'finished_goods',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Finished goods stock updated:', payload);
          // Refetch products when finished goods stock changes
          fetchProducts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id, fetchProducts]);

  const addProduct = useCallback(async (productData: Omit<Product, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> & {
    components?: any[];
    skus?: any[];
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
      // Extract components and skus from productData
      const { components, skus, ...productFields } = productData;

      console.log('Adding product with data:', productFields);

      // Create product with current tenant ID
      const { data, error } = await supabase
        .from('products')
        .insert({
          ...productFields,
          tenant_id: tenant?.id
        })
        .select()
        .single();

      if (error) {
        console.error('Product insert error:', error);
        throw error;
      }

      console.log('Product created successfully:', data);

      // Save components if they exist
      if (components && components.length > 0) {
        const componentInserts = components.map(component => ({
          product_id: data.id,
          component_name: component.component_name,
          component_type: component.component_type,
          quantity_required: component.quantity_required,
          notes: component.notes,
          tenant_id: tenant?.id
        }));

        const { error: componentError } = await supabase
          .from('product_components')
          .insert(componentInserts);

        if (componentError) {
          console.error('Error saving components:', componentError);
          // Don't throw here - product is already created
        }
      }

      // Save SKUs if they exist
      if (skus && skus.length > 0) {
        const skuInserts = skus.map(sku => ({
          product_id: data.id,
          sku: sku.sku,
          color: sku.color,
          filament_type: sku.filament_type,
          hex_code: sku.hex_code,
          quantity: sku.quantity,
          stock_level: sku.stock_level || 0,
          price: sku.price,
          tenant_id: tenant?.id
        }));

        const { error: skuError } = await supabase
          .from('product_skus')
          .insert(skuInserts);

        if (skuError) {
          console.error('Error saving SKUs:', skuError);
          // Don't throw here - product is already created
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
  }) => {
    try {
      // Extract components and skus from updates
      const { components, skus, ...productUpdates } = updates;

      const { data, error } = await supabase
        .from('products')
        .update(productUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Handle components if they exist
      if (components !== undefined) {
        // Delete existing components
        await supabase
          .from('product_components')
          .delete()
          .eq('product_id', id);

        // Insert new components
        if (components.length > 0) {
          const componentInserts = components.map(component => ({
            product_id: id,
            component_name: component.component_name,
            component_type: component.component_type,
            quantity_required: component.quantity_required,
            notes: component.notes,
            tenant_id: tenant?.id
          }));

          const { error: componentError } = await supabase
            .from('product_components')
            .insert(componentInserts);

          if (componentError) {
            console.error('Error updating components:', componentError);
          }
        }
      }

      // Handle SKUs with proper differential updates
      if (skus !== null && skus !== undefined && Array.isArray(skus)) {
        console.log('Updating SKUs for product:', id, skus);
        
        // Get current SKUs from database
        const { data: currentSkus, error: fetchError } = await supabase
          .from('product_skus')
          .select('*')
          .eq('product_id', id)
          .eq('is_active', true);
          
        if (fetchError) {
          console.error('Error fetching current SKUs:', fetchError);
          throw fetchError;
        }
        
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
          if (sku.id && sku.id.startsWith('temp-')) {
            // This is a new SKU (temp ID)
            skusToInsert.push({
              product_id: id,
              sku: sku.sku,
              color: sku.color,
              filament_type: sku.filament_type,
              hex_code: sku.hex_code,
              quantity: sku.quantity,
              stock_level: sku.stock_level || 0,
              price: sku.price,
              tenant_id: tenant?.id
            });
          } else if (sku.id && currentSkusMap.has(sku.id)) {
            // This is an existing SKU that might need updates
            const currentSku = currentSkusMap.get(sku.id);
            newSkusMap.set(sku.id, sku);
            
            // Check if any fields have changed
            const hasChanges = (
              currentSku.sku !== sku.sku ||
              currentSku.color !== sku.color ||
              currentSku.filament_type !== sku.filament_type ||
              currentSku.hex_code !== sku.hex_code ||
              currentSku.quantity !== sku.quantity ||
              currentSku.stock_level !== sku.stock_level ||
              currentSku.price !== sku.price
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
                price: sku.price
              });
            }
          }
        });
        
        // Find SKUs that were deleted (exist in current but not in new)
        const skusToDeactivate = [];
        currentSkus?.forEach(currentSku => {
          if (!newSkusMap.has(currentSku.id) && !skus.some(s => s.id === currentSku.id)) {
            skusToDeactivate.push(currentSku.id);
          }
        });
        
        // Execute the changes
        
        // 1. Insert new SKUs
        if (skusToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from('product_skus')
            .insert(skusToInsert);
            
          if (insertError) {
            console.error('Error inserting new SKUs:', insertError);
            throw insertError;
          }
        }
        
        // 2. Update existing SKUs
        for (const skuUpdate of skusToUpdate) {
          const { id, ...updateFields } = skuUpdate;
          const { error: updateError } = await supabase
            .from('product_skus')
            .update(updateFields)
            .eq('id', id);
            
          if (updateError) {
            console.error('Error updating SKU:', updateError);
            throw updateError;
          }
        }
        
        // 3. Deactivate deleted SKUs
        if (skusToDeactivate.length > 0) {
          const { error: deactivateError } = await supabase
            .from('product_skus')
            .update({ is_active: false })
            .in('id', skusToDeactivate);
            
          if (deactivateError) {
            console.error('Error deactivating SKUs:', deactivateError);
            throw deactivateError;
          }
        }
        
        console.log('SKU operations completed:', {
          inserted: skusToInsert.length,
          updated: skusToUpdate.length,
          deactivated: skusToDeactivate.length
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
    }
  }, [tenant?.id, toast, fetchProducts]);

  const deleteProduct = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product deleted successfully",
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
      // Insert the new SKU
      const { data: skuResult, error: skuError } = await supabase
        .from('product_skus')
        .insert({
          ...skuData,
          tenant_id: tenant?.id
        })
        .select()
        .single();

      if (skuError) {
        console.error('Supabase error in addSku:', skuError);
        throw skuError;
      }

      console.log('addSku successful, data:', skuResult);

      // Create corresponding finished_goods record
      const { error: finishedGoodsError } = await supabase
        .from('finished_goods')
        .insert({
          tenant_id: tenant?.id,
          product_sku_id: skuResult.id,
          sku: skuData.sku,
          color: skuData.color,
          material: skuData.filament_type || 'PLA', // Use filament_type from SKU
          current_stock: skuData.stock_level || 0,
          assembly_status: 'printed',
          unit_price: skuData.price || 0,
          status: (skuData.stock_level || 0) > 0 ? ((skuData.stock_level || 0) <= 5 ? 'low_stock' : 'in_stock') : 'out_of_stock'
        });

      if (finishedGoodsError) {
        console.warn('Warning: Could not create finished_goods record:', finishedGoodsError);
        // Don't fail the whole operation if finished_goods creation fails
      }

      toast({
        title: "Success",
        description: "SKU added successfully",
      });

      await fetchProducts();
      return skuResult;
    } catch (error) {
      console.error('Error adding SKU:', error);
      toast({
        title: "Error",
        description: "Failed to add SKU",
        variant: "destructive",
      });
      throw error; // Re-throw to ensure calling code knows about the failure
    }
  }, [tenant?.id, toast, fetchProducts]);

  const updateSku = useCallback(async (id: string, updates: Partial<ProductSku>) => {
    console.log('updateSku called with:', id, updates);
    try {
      const { data, error } = await supabase
        .from('product_skus')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Supabase error in updateSku:', error);
        throw error;
      }

      console.log('updateSku successful, data:', data);
      toast({
        title: "Success",
        description: "SKU updated successfully",
      });

      await fetchProducts();
      return data;
    } catch (error) {
      console.error('Error updating SKU:', error);
      toast({
        title: "Error",
        description: "Failed to update SKU",
        variant: "destructive",
      });
      throw error; // Re-throw to ensure calling code knows about the failure
    }
  }, [toast, fetchProducts]);

  const deleteSku = useCallback(async (id: string) => {
    try {
      // First, soft delete the SKU
      const { error: skuError } = await supabase
        .from('product_skus')
        .update({ is_active: false })
        .eq('id', id);

      if (skuError) throw skuError;

      // Also soft delete the corresponding finished_goods record
      const { error: finishedGoodsError } = await supabase
        .from('finished_goods')
        .update({ is_active: false })
        .eq('product_sku_id', id);

      if (finishedGoodsError) {
        console.warn('Warning: Could not soft delete finished_goods record:', finishedGoodsError);
        // Don't fail the whole operation if finished_goods update fails
      }

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

  const addComponent = useCallback(async (componentData: Omit<ProductComponent, 'id' | 'created_at'>) => {
    try {
      const { data, error } = await supabase
        .from('product_components')
        .insert({
          ...componentData,
          tenant_id: tenant?.id
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Component added successfully",
      });

      await fetchProducts();
      return data;
    } catch (error) {
      console.error('Error adding component:', error);
      toast({
        title: "Error",
        description: "Failed to add component",
        variant: "destructive",
      });
    }
  }, [tenant?.id, toast, fetchProducts]);

  const deleteComponent = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('product_components')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Component deleted successfully",
      });

      await fetchProducts();
    } catch (error) {
      console.error('Error deleting component:', error);
      toast({
        title: "Error",
        description: "Failed to delete component",
        variant: "destructive",
      });
    }
  }, [toast, fetchProducts]);

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
    addComponent,
    deleteComponent,
    refetch: fetchProducts,
  };
};
