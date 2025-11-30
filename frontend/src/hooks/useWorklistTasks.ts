import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
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

  const fetchTasks = useCallback(async () => {
    // Don't fetch if tenant is not available yet
    if (!tenant?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Use api client which automatically includes X-Tenant-ID header
      const data = await api.get<WorklistTask[]>('/api/v1/worklist');
      setTasks(Array.isArray(data) ? data : []);
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
  }, [tenant?.id, toast]);

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
        await api.post(`/api/v1/printers/${currentTask.printer_id}/maintenance/complete`, {
          task_id: id,
        });

        // The backend handles updating both the task and the printer, so we're done
        toast({
          title: "Success",
          description: "Maintenance completed successfully. Printer returned to idle status.",
        });

        await fetchTasks();
        return; // Early return, backend already handled everything
      }

      await api.patch(`/api/v1/worklist/${id}`, updateData);

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

    // Get assembly task details from backend API
    const assemblyTask = await api.get<any>(`/api/v1/assembly/${assemblyTaskId}`);

    if (!assemblyTask?.finished_good_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get finished good to find product_sku_id from backend API
    const finishedGood = await api.get<any>(`/api/v1/inventory/${assemblyTask.finished_good_id}`);

    if (!finishedGood?.product_sku_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get product SKU to find product_id from backend API
    const productSku = await api.get<any>(`/api/v1/skus/${finishedGood.product_sku_id}`);

    if (!productSku?.product_id) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Get product components required for assembly
    let components: any[] = [];
    try {
      components = await api.get<any[]>(`/api/v1/products/${productSku.product_id}/components`);
    } catch (err) {
      // No components defined for this product
      console.log('No components found for product:', productSku.product_id);
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    if (!components || components.length === 0) {
      return { hasShortage: false, shortages: [], components: [], assemblyTask };
    }

    // Check availability of all required components using the cloud API
    const quantityNeeded = assemblyTask.quantity || 1;
    const componentsToCheck = components.map((c: any) => ({
      component_type: c.component_name || c.component_type,
      quantity_needed: (c.quantity_required || 1) * quantityNeeded
    }));

    try {
      const availabilityResult = await api.post<{
        has_shortage: boolean;
        components: Array<{
          component_type: string;
          quantity_needed: number;
          quantity_available: number;
          has_shortage: boolean;
          shortage_amount: number;
          component_id: string | null;
        }>;
      }>('/api/v1/materials/components/check-availability', { components: componentsToCheck });

      // Build shortages array for UI display
      for (const result of availabilityResult.components) {
        if (result.has_shortage) {
          shortages.push({
            componentName: result.component_type,
            needed: result.quantity_needed,
            available: result.quantity_available
          });
        }
      }

      return {
        hasShortage: availabilityResult.has_shortage,
        shortages,
        components,
        assemblyTask
      };
    } catch (err) {
      console.error('Error checking component availability:', err);
      // If the availability check fails, proceed without blocking (fail open)
      return { hasShortage: false, shortages: [], components, assemblyTask };
    }
  };

  const syncToAssemblyTask = async (assemblyTaskId: string, status: WorklistTask['status'], forceComplete: boolean = false) => {
    try {
      if (status === 'completed') {
        // Use the dedicated completion endpoint which properly updates inventory
        // This moves quantity from quantity_needs_assembly to quantity_assembled
        await api.post(`/api/v1/assembly/${assemblyTaskId}/complete`, {
          notes: 'Completed via worklist'
        });
        console.log(`Completed assembly task ${assemblyTaskId} via completion endpoint`);
      } else {
        // For non-completion status changes, use the update endpoint
        const statusMapping: Record<string, string> = {
          'pending': 'pending',
          'in_progress': 'in_progress',
          'cancelled': 'pending' // Reset cancelled tasks back to pending
        };

        await api.put(`/api/v1/assembly/${assemblyTaskId}`, {
          status: statusMapping[status]
        });
        console.log(`Synced worklist status '${status}' to assembly task ${assemblyTaskId}`);
      }
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

      await api.patch(`/api/v1/worklist/${id}`, updateData);

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
        const { productName, skuId, sku, quantity } = taskData.metadata;

        // Fetch the finished good record by SKU ID to get the actual finished_good_id
        const finishedGood = await api.get<any>(`/api/v1/inventory/by-sku/${skuId}`);

        if (!finishedGood) {
          throw new Error(`No finished good found for this SKU. Please ensure the product has finished goods inventory.`);
        }

        // Create assembly task via assembly-tasks API using the finished good ID
        const assemblyTask = await api.post<any>('/api/v1/assembly', {
          finished_good_id: finishedGood.id, // Use actual finished goods ID, not SKU ID
          product_name: productName,
          sku: sku,
          quantity: quantity,
          assigned_to: taskData.assigned_to,
          notes: taskData.description
        });

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

      await api.post('/api/v1/worklist', worklistPayload);

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
      await api.patch(`/api/v1/worklist/${id}`, { assigned_to: assignedTo });

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
      await api.delete(`/api/v1/worklist/${id}`);

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
  }, [fetchTasks]);

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