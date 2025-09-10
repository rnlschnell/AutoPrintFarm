import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { 
  FrontendPrintJob, 
  transformPrintJobFromDb, 
  transformPrintJobToDb,
  DbPrintJob 
} from '@/lib/transformers';

export type { FrontendPrintJob as PrintJob };

export const usePrintJobs = () => {
  const [printJobs, setPrintJobs] = useState<FrontendPrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const fetchPrintJobs = async () => {
    if (!tenant?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('tenant_id', tenant?.id)
        .order('time_submitted', { ascending: false });

      if (error) throw error;

      const transformedJobs = (data || []).map(job => transformPrintJobFromDb(job as DbPrintJob));

      setPrintJobs(transformedJobs);
    } catch (error: any) {
      console.error('Error fetching print jobs:', error);
      // Only show toast for unexpected errors, not for missing table/data scenarios
      if (error?.code !== 'PGRST116' && error?.code !== '42P01') {
        toast({
          title: "Error",
          description: "Failed to load print jobs from database.",
          variant: "destructive",
        });
      }
      // Set empty array for missing table scenarios
      setPrintJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const addPrintJob = async (jobData: {
    printerId?: string;
    printFileId: string;
    fileName: string;
    color: string;
    filamentType: string;
    materialType: string;
    numberOfUnits?: number;
    filamentNeededGrams?: number;
    estimatedPrintTimeMinutes?: number;
    priority?: number;
  }) => {
    try {
      const insertData = {
        printer_id: jobData.printerId,
        print_file_id: jobData.printFileId,
        file_name: jobData.fileName,
        status: 'queued',
        color: jobData.color,
        filament_type: jobData.filamentType,
        material_type: jobData.materialType,
        number_of_units: jobData.numberOfUnits || 1,
        filament_needed_grams: jobData.filamentNeededGrams,
        estimated_print_time_minutes: jobData.estimatedPrintTimeMinutes,
        priority: jobData.priority || 0,
        progress_percentage: 0,
        time_submitted: new Date().toISOString(),
        tenant_id: tenant?.id
      };

      const { data, error } = await supabase
        .from('print_jobs')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      const newJob = transformPrintJobFromDb(data as DbPrintJob);

      setPrintJobs(prev => [newJob, ...prev]);
      toast({
        title: "Success",
        description: `Print job for ${jobData.fileName} has been created.`,
      });

      return newJob;
    } catch (error) {
      console.error('Error adding print job:', error);
      toast({
        title: "Error",
        description: "Failed to create print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrintJob = async (id: string, updates: Partial<FrontendPrintJob>) => {
    try {
      const updateData = transformPrintJobToDb(updates);

      const { data, error } = await supabase
        .from('print_jobs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const updatedJob = transformPrintJobFromDb(data as DbPrintJob);

      setPrintJobs(prev => prev.map(job => 
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print job updated successfully.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error updating print job:', error);
      toast({
        title: "Error",
        description: "Failed to update print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deletePrintJob = async (id: string) => {
    try {
      const { error } = await supabase
        .from('print_jobs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPrintJobs(prev => prev.filter(job => job.id !== id));
      toast({
        title: "Success",
        description: "Print job deleted successfully.",
      });
    } catch (error) {
      console.error('Error deleting print job:', error);
      toast({
        title: "Error",
        description: "Failed to delete print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const cancelPrintJob = async (id: string, reason?: string) => {
    try {
      const { data, error } = await supabase
        .from('print_jobs')
        .update({ 
          status: 'cancelled',
          failure_reason: reason,
          time_completed: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const updatedJob = transformPrintJobFromDb(data as DbPrintJob);

      setPrintJobs(prev => prev.map(job => 
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print job cancelled successfully.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error cancelling print job:', error);
      toast({
        title: "Error",
        description: "Failed to cancel print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    if (tenant?.id) {
      fetchPrintJobs();
    }
  }, [tenant?.id]);

  return {
    printJobs,
    loading,
    addPrintJob,
    updatePrintJob,
    deletePrintJob,
    cancelPrintJob,
    refetch: fetchPrintJobs
  };
};