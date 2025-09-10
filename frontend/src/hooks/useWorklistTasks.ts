import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';

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
  const { tenant } = useTenant();
  const { toast } = useToast();

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('worklist_tasks')
        .select('*')
        .eq('tenant_id', tenant?.id || '550e8400-e29b-41d4-a716-446655440000')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks((data || []) as WorklistTask[]);
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
      if (status === 'in_progress') {
        updateData.started_at = new Date().toISOString();
        updateData.completed_at = null;
        updateData.actual_time_minutes = null;
      } else if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
        
        // Calculate actual time if task was started
        const currentTask = tasks.find(t => t.id === id);
        if (currentTask?.started_at) {
          const startTime = new Date(currentTask.started_at);
          const endTime = new Date();
          updateData.actual_time_minutes = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));
        }
      } else if (status === 'cancelled') {
        updateData.completed_at = null;
        updateData.actual_time_minutes = null;
      }

      const { error } = await supabase
        .from('worklist_tasks')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Task ${status === 'cancelled' ? 'cancelled' : `marked as ${status.replace('_', ' ')}`}`,
      });

      await fetchTasks();
    } catch (error) {
      console.error('Error updating task status:', error);
      toast({
        title: "Error",
        description: "Failed to update task status",
        variant: "destructive",
      });
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

  const createTask = async (taskData: Partial<WorklistTask>) => {
    try {
      const { error } = await supabase
        .from('worklist_tasks')
        .insert({
          ...taskData,
          tenant_id: tenant?.id || '550e8400-e29b-41d4-a716-446655440000', // Using demo tenant as fallback
          task_type: taskData.task_type || 'collection', // Ensure task_type is always set
          title: taskData.title || 'New Task', // Ensure title is always set
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Task created successfully",
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
      const { error } = await supabase
        .from('worklist_tasks')
        .update({ assigned_to: assignedTo })
        .eq('id', id);

      if (error) throw error;

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

  const getElapsedTime = (startedAt: string): number => {
    const start = new Date(startedAt);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60)); // minutes
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // Set up real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('worklist-tasks-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'worklist_tasks'
        },
        () => {
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    tasks,
    loading,
    updateTaskStatus,
    cancelTask,
    startTask,
    completeTask,
    createTask,
    assignTask,
    getElapsedTime,
    refetch: fetchTasks
  };
};