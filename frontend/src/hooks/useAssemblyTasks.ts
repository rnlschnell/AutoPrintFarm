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
      const { data, error } = await supabase
        .from('assembly_tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks((data || []) as AssemblyTask[]);
    } catch (error) {
      console.error('Error fetching assembly tasks:', error);
      toast({
        title: "Error",
        description: "Failed to load assembly tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (id: string, status: AssemblyTask['status'], notes?: string) => {
    try {
      const updateData: any = { status };
      if (notes) updateData.notes = notes;

      const { error } = await supabase
        .from('assembly_tasks')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Task marked as ${status}`,
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

  const assignTask = async (id: string, assignedTo: string) => {
    try {
      const { error } = await supabase
        .from('assembly_tasks')
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