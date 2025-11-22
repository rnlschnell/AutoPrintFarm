import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';

export interface AssemblyTask {
  id: string;
  tenant_id: string;
  finished_good_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  status: 'pending' | 'in_progress' | 'completed';
  assigned_to?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export const useAssemblyTasks = () => {
  const [tasks, setTasks] = useState<AssemblyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useTenant();
  const { toast } = useToast();

  const fetchTasks = async () => {
    try {
      setLoading(true);
      // NOTE: Supabase calls removed - this hook is deprecated
      // Assembly tasks are now managed through useWorklistTasks
      console.warn('useAssemblyTasks is deprecated - use useWorklistTasks instead');
      setTasks([]);
    } catch (error) {
      console.error('Error fetching assembly tasks:', error);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  const openWikiForTask = async (taskId: string): Promise<string | null> => {
    try {
      // Fetch the wiki for this assembly task from backend
      const response = await fetch(`/api/assembly-tasks/${taskId}/wiki`);
      if (!response.ok) {
        console.warn('Failed to fetch wiki for task:', response.statusText);
        return null;
      }

      const data = await response.json();
      if (data.wiki_id) {
        toast({
          title: "Assembly Instructions Available",
          description: `Opening wiki for ${data.product_name}`,
        });
        return data.wiki_id; // Return wiki_id instead of opening window
      }
      return null;
    } catch (error) {
      console.error('Error fetching wiki for task:', error);
      // Don't show error toast - wiki is optional
      return null;
    }
  };

  const updateTaskStatus = async (id: string, status: AssemblyTask['status'], notes?: string): Promise<string | null> => {
    try {
      const updateData: any = { status };
      if (notes) updateData.notes = notes;

      // If starting the task, get wiki_id
      let wikiId: string | null = null;
      if (status === 'in_progress') {
        wikiId = await openWikiForTask(id);
      }

      // If completing the task, consume component inventory first
      if (status === 'completed') {
        const task = tasks.find(t => t.id === id);
        if (task && tenant?.id) {
          try {
            // Get the finished good to find product info from backend API (SQLite)
            const finishedGoodResponse = await fetch(`/api/finished-goods-sync/${task.finished_good_id}`);
            if (!finishedGoodResponse.ok) {
              throw new Error(`Failed to get finished good: ${finishedGoodResponse.statusText}`);
            }
            const finishedGood = await finishedGoodResponse.json();

            if (finishedGood?.product_sku_id) {
              // Get product SKU to find product_id from backend API (SQLite)
              const productSkuResponse = await fetch(`/api/product-skus-sync/${finishedGood.product_sku_id}`);
              if (!productSkuResponse.ok) {
                throw new Error(`Failed to get product SKU: ${productSkuResponse.statusText}`);
              }
              const productSku = await productSkuResponse.json();

              if (productSku?.product_id) {
                // Get product components
                const { data: components, error: compError } = await supabase
                  .from('product_components')
                  .select('*')
                  .eq('product_id', productSku.product_id)
                  .eq('tenant_id', tenant.id);

                if (compError) throw compError;

                // Consume inventory for each component
                if (components && components.length > 0) {
                  for (const component of components) {
                    if (component.accessory_id) {
                      const quantityToConsume = component.quantity_required * task.quantity;

                      // Get current inventory
                      const { data: accessory, error: invError } = await supabase
                        .from('accessories_inventory')
                        .select('remaining_units')
                        .eq('id', component.accessory_id)
                        .single();

                      if (invError) throw invError;

                      const currentStock = accessory?.remaining_units || 0;

                      if (currentStock < quantityToConsume) {
                        throw new Error(
                          `Insufficient inventory for ${component.component_name}: need ${quantityToConsume}, only ${currentStock} available`
                        );
                      }

                      // Update inventory
                      const { error: updateError } = await supabase
                        .from('accessories_inventory')
                        .update({ remaining_units: currentStock - quantityToConsume })
                        .eq('id', component.accessory_id);

                      if (updateError) throw updateError;

                      console.log(`Consumed ${quantityToConsume} units of ${component.component_name}`);
                    }
                  }
                }
              }
            }
          } catch (invError: any) {
            console.error('Error consuming inventory:', invError);
            toast({
              title: "Inventory Error",
              description: invError.message || "Failed to update inventory",
              variant: "destructive",
            });
            return; // Don't complete the task if inventory fails
          }
        }
      }

      // Update assembly task via backend API (SQLite)
      const response = await fetch(`/api/assembly-tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update assembly task: ${response.statusText}`);
      }

      toast({
        title: "Success",
        description: `Task marked as ${status}`,
      });

      await fetchTasks();
      return wikiId; // Return wiki_id to caller for navigation
    } catch (error) {
      console.error('Error updating task status:', error);
      toast({
        title: "Error",
        description: "Failed to update task status",
        variant: "destructive",
      });
      return null;
    }
  };

  const assignTask = async (id: string, assignedTo: string) => {
    // NOTE: Supabase calls removed - this hook is deprecated
    // Use useWorklistTasks instead
    console.warn('useAssemblyTasks.assignTask is deprecated - use useWorklistTasks instead');
    toast({
      title: "Error",
      description: "This hook is deprecated. Please use useWorklistTasks.",
      variant: "destructive",
    });
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  return {
    tasks,
    loading,
    updateTaskStatus,
    assignTask,
    refetch: fetchTasks
  };
};