import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useNavigate } from 'react-router-dom';

export interface WorklistTask {
  id: string;
  tenant_id: string;
  title: string;
  subtitle?: string;
  description?: string;
  task_type: 'assembly' | 'filament_change' | 'collection' | 'maintenance' | 'quality_check';
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assigned_to?: string;
  estimated_time_minutes?: number;
  actual_time_minutes?: number;
  started_at?: string;
  completed_at?: string;
  due_date?: string;
  printer_id?: string;
  order_number?: string;
  assembly_task_id?: string;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export const useWorklistTasks = () => {
  const [tasks, setTasks] = useState<WorklistTask[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/worklist/');

      if (!response.ok) {
        throw new Error(`Failed to fetch worklist tasks: ${response.statusText}`);
      }

      const data = await response.json();
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching worklist tasks:', error);
      toast({
        title: "Error",
        description: "Failed to load worklist tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (id: string, status: WorklistTask['status']) => {
    try {
      const updateData: any = { status };

      // Add timestamps based on status
      // Note: started_at, completed_at, and actual_time_minutes are now handled by the backend
      if (status === 'in_progress') {
        updateData.started_at = new Date().toISOString();
        updateData.completed_at = null;
        updateData.actual_time_minutes = null;
      } else if (status === 'completed') {
        // Backend will automatically calculate actual_time_minutes from started_at and completed_at
        // No need to send completed_at or actual_time_minutes - backend handles it
      } else if (status === 'cancelled') {
        // Reset cancelled tasks to pending status so they return to the To Do tab
        updateData.status = 'pending';
        updateData.started_at = null;
        updateData.completed_at = null;
        updateData.actual_time_minutes = null;
      }

      // IMPORTANT: For assembly tasks being completed, consume inventory
      // Note: Inventory checking is now handled by the UI before calling this
      const currentTask = tasks.find(t => t.id === id);
      if (status === 'completed' && currentTask?.assembly_task_id && currentTask.task_type === 'assembly') {
        await syncToAssemblyTask(currentTask.assembly_task_id, status, false);
      }

      // IMPORTANT: For maintenance tasks being completed, call the maintenance/complete endpoint
      if (status === 'completed' && currentTask?.task_type === 'maintenance' && currentTask?.printer_id) {
        const maintenanceResponse = await fetch(`/api/printers/${currentTask.printer_id}/maintenance/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            task_id: id,
          }),
        });

        if (!maintenanceResponse.ok) {
          const errorData = await maintenanceResponse.json();
          throw new Error(errorData.detail || `Failed to complete maintenance: ${maintenanceResponse.statusText}`);
        }

        // The backend handles updating both the task and the printer, so we're done
        toast({
          title: "Success",
          description: "Maintenance completed successfully. Printer returned to idle status.",
        });

        await fetchTasks();
        return; // Early return, backend already handled everything
      }

      const response = await fetch(`/api/worklist/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update task status: ${response.statusText}`);
      }

      // Sync to assembly task for other statuses (not completed, already handled above)
      if (status !== 'completed' && currentTask?.assembly_task_id && currentTask.task_type === 'assembly') {
        await syncToAssemblyTask(currentTask.assembly_task_id, status);
      }

      toast({
        title: "Success",
        description: `Task ${status === 'cancelled' ? 'cancelled' : `marked as ${status.replace('_', ' ')}`}`,
      });

      await fetchTasks();
    } catch (error: any) {
      console.error('Error updating task status:', error);

      // Extract the actual error message instead of using generic text
      const errorMessage = error?.message || "Failed to update task status";

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Check inventory before task completion and return shortage information (exported for UI use)
  const checkInventoryAvailability = async (assemblyTaskId: string): Promise<{
    hasShortage: boolean;
    shortages: Array<{ componentName: string; needed: number; available: number }>;
    components: any[];
    assemblyTask: any;
  }> => {
    const shortages: Array<{ componentName: string; needed: number; available: number }> = [];

    if (!tenant?.id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask: null };
    }

    // Get assembly task details from backend API (SQLite)
    const assemblyTaskResponse = await fetch(`/api/assembly-tasks/${assemblyTaskId}`);
    if (!assemblyTaskResponse.ok) {
      throw new Error(`Failed to get assembly task: ${assemblyTaskResponse.statusText}`);
    }
    const assemblyTask = await assemblyTaskResponse.json();

    if (!assemblyTask?.finished_good_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get finished good to find product_sku_id from backend API (SQLite)
    const finishedGoodResponse = await fetch(`/api/finished-goods-sync/${assemblyTask.finished_good_id}`);
    if (!finishedGoodResponse.ok) {
      throw new Error(`Failed to get finished good: ${finishedGoodResponse.statusText}`);
    }
    const finishedGood = await finishedGoodResponse.json();

    if (!finishedGood?.product_sku_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get product SKU to find product_id from backend API (SQLite)
    const productSkuResponse = await fetch(`/api/product-skus-sync/${finishedGood.product_sku_id}`);
    if (!productSkuResponse.ok) {
      throw new Error(`Failed to get product SKU: ${productSkuResponse.statusText}`);
    }
    const productSku = await productSkuResponse.json();

    if (!productSku?.product_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get product components
    const { data: components, error: compError } = await supabase
      .from('product_components')
      .select('*')
      .eq('product_id', productSku.product_id)
      .eq('tenant_id', tenant.id);

    if (compError) throw compError;

    // Check each component for shortages
    if (components && components.length > 0) {
      for (const component of components) {
        if (component.accessory_id) {
          const quantityNeeded = component.quantity_required * assemblyTask.quantity;

          // Get current inventory
          const { data: accessory, error: invError } = await supabase
            .from('accessories_inventory')
            .select('remaining_units')
            .eq('id', component.accessory_id)
            .single();

          if (invError) throw invError;

          const currentStock = accessory?.remaining_units || 0;

          if (currentStock < quantityNeeded) {
            shortages.push({
              componentName: component.component_name,
              needed: quantityNeeded,
              available: currentStock
            });
          }
        }
      }
    }

    return {
      hasShortage: shortages.length > 0,
      shortages,
      components: components || [],
      assemblyTask
    };
  };

  const syncToAssemblyTask = async (assemblyTaskId: string, status: WorklistTask['status'], forceComplete: boolean = false) => {
    try {
      // Map worklist status to assembly status
      const statusMapping = {
        'pending': 'pending',
        'in_progress': 'in_progress',
        'completed': 'completed',
        'cancelled': 'pending' // Reset cancelled tasks back to pending
      };

      const assemblyStatus = statusMapping[status];
      const updateData: any = { status: assemblyStatus };

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();

        // Consume component inventory when completing assembly task
        if (tenant?.id) {
          try {
            // Get assembly task details from backend API (SQLite)
            const assemblyTaskResponse = await fetch(`/api/assembly-tasks/${assemblyTaskId}`);
            if (!assemblyTaskResponse.ok) {
              throw new Error(`Failed to get assembly task: ${assemblyTaskResponse.statusText}`);
            }
            const assemblyTask = await assemblyTaskResponse.json();

            if (assemblyTask?.finished_good_id) {
              // Get finished good to find product_sku_id from backend API (SQLite)
              const finishedGoodResponse = await fetch(`/api/finished-goods-sync/${assemblyTask.finished_good_id}`);
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
                        const quantityToConsume = component.quantity_required * assemblyTask.quantity;

                        // Get current inventory
                        const { data: accessory, error: invError } = await supabase
                          .from('accessories_inventory')
                          .select('remaining_units')
                          .eq('id', component.accessory_id)
                          .single();

                        if (invError) throw invError;

                        const currentStock = accessory?.remaining_units || 0;

                        // If forceComplete is true, consume what we can and floor at 0
                        // Otherwise, check for sufficient inventory
                        if (!forceComplete && currentStock < quantityToConsume) {
                          throw new Error(
                            `Insufficient inventory for ${component.component_name}: need ${quantityToConsume}, only ${currentStock} available`
                          );
                        }

                        // Calculate actual consumption (floor at 0)
                        const actualConsumption = Math.min(currentStock, quantityToConsume);
                        const newStock = Math.max(0, currentStock - quantityToConsume);

                        // Update inventory
                        const { error: updateError } = await supabase
                          .from('accessories_inventory')
                          .update({ remaining_units: newStock })
                          .eq('id', component.accessory_id);

                        if (updateError) throw updateError;

                        console.log(`Consumed ${actualConsumption} units of ${component.component_name} (${newStock} remaining)`);
                      }
                    }
                  }
                }
              }
            }
          } catch (invError: any) {
            console.error('Error consuming inventory:', invError);
            // Only show toast if not forcing complete (forceComplete means user already confirmed)
            if (!forceComplete) {
              toast({
                title: "Inventory Error",
                description: invError.message || "Failed to update inventory",
                variant: "destructive",
              });
            }
            throw invError; // Re-throw to prevent task completion
          }
        }
      }

      // Call the assembly tasks API to update the status
      const response = await fetch(`/api/assembly-tasks/${assemblyTaskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update assembly task: ${response.statusText}`);
      }

      console.log(`Synced worklist status '${status}' to assembly task ${assemblyTaskId}`);
    } catch (error) {
      console.error('Error syncing to assembly task:', error);
      // Re-throw the error so the task status update fails
      throw error;
    }
  };

  const cancelTask = async (id: string) => {
    await updateTaskStatus(id, 'cancelled');
  };

  const startTask = async (id: string) => {
    await updateTaskStatus(id, 'in_progress');
  };

  const completeTask = async (id: string) => {
    await updateTaskStatus(id, 'completed');
  };

  // Force complete a task, bypassing inventory checks (used after user confirms shortage)
  const completeTaskForced = async (id: string) => {
    try {
      const updateData: any = { status: 'completed' };

      // For assembly tasks, force complete with inventory floored at 0
      const currentTask = tasks.find(t => t.id === id);
      if (currentTask?.assembly_task_id && currentTask.task_type === 'assembly') {
        // Force complete - inventory will floor at 0
        await syncToAssemblyTask(currentTask.assembly_task_id, 'completed', true);
      }

      const response = await fetch(`/api/worklist/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update task status: ${response.statusText}`);
      }

      toast({
        title: "Success",
        description: "Task marked as completed",
      });

      await fetchTasks();
    } catch (error: any) {
      console.error('Error force completing task:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to complete task",
        variant: "destructive",
      });
    }
  };

  const createTask = async (taskData: Partial<WorklistTask> & { metadata?: any }) => {
    try {
      let assemblyTaskId: string | undefined;

      // For assembly tasks, create the assembly task first
      if (taskData.task_type === 'assembly' && taskData.metadata) {
        const { productId, productName, skuId, sku, quantity } = taskData.metadata;

        // Fetch the finished good record by SKU ID to get the actual finished_good_id
        const finishedGoodResponse = await fetch(`/api/finished-goods-sync/by-sku/${skuId}`);

        if (!finishedGoodResponse.ok) {
          throw new Error(`No finished good found for this SKU. Please ensure the product has finished goods inventory.`);
        }

        const finishedGood = await finishedGoodResponse.json();

        // Create assembly task via assembly-tasks API using the finished good ID
        const assemblyResponse = await fetch('/api/assembly-tasks/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            finished_good_id: finishedGood.id, // Use actual finished goods ID, not SKU ID
            product_name: productName,
            sku: sku,
            quantity: quantity,
            assigned_to: taskData.assigned_to,
            notes: taskData.description
          }),
        });

        if (!assemblyResponse.ok) {
          throw new Error(`Failed to create assembly task: ${assemblyResponse.statusText}`);
        }

        const assemblyTask = await assemblyResponse.json();
        assemblyTaskId = assemblyTask.id;
      }

      // Create worklist task
      const worklistPayload: any = {
        ...taskData,
        task_type: taskData.task_type || 'collection',
        title: taskData.title || 'New Task',
      };

      // Add assembly_task_id if we created an assembly task
      if (assemblyTaskId) {
        worklistPayload.assembly_task_id = assemblyTaskId;
      }

      // Remove metadata from worklist payload (it's only used for assembly task creation)
      delete worklistPayload.metadata;

      const response = await fetch('/api/worklist/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(worklistPayload),
      });

      if (!response.ok) {
        throw new Error(`Failed to create worklist task: ${response.statusText}`);
      }

      toast({
        title: "Success",
        description: taskData.task_type === 'assembly'
          ? "Assembly task created successfully"
          : "Task created successfully",
      });

      await fetchTasks();
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error",
        description: "Failed to create task",
        variant: "destructive",
      });
    }
  };

  const assignTask = async (id: string, assignedTo: string) => {
    try {
      const response = await fetch(`/api/worklist/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assigned_to: assignedTo }),
      });

      if (!response.ok) {
        throw new Error(`Failed to assign task: ${response.statusText}`);
      }

      toast({
        title: "Success",
        description: "Task assigned successfully",
      });

      await fetchTasks();
    } catch (error) {
      console.error('Error assigning task:', error);
      toast({
        title: "Error",
        description: "Failed to assign task",
        variant: "destructive",
      });
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const response = await fetch(`/api/worklist/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete task: ${response.statusText}`);
      }

      toast({
        title: "Success",
        description: "Task deleted successfully",
      });

      await fetchTasks();
    } catch (error) {
      console.error('Error deleting task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const getElapsedTime = (startedAt: string): number => {
    // Ensure timestamp is parsed as UTC by appending 'Z' if not present
    const utcStartedAt = startedAt.endsWith('Z') ? startedAt : startedAt + 'Z';
    const start = new Date(utcStartedAt);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60)); // minutes
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  return {
    tasks,
    loading,
    updateTaskStatus,
    cancelTask,
    startTask,
    completeTask,
    completeTaskForced,
    checkInventoryAvailability,
    createTask,
    assignTask,
    deleteTask,
    getElapsedTime,
    refetch: fetchTasks
  };
};