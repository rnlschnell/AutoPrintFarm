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
      // Fetch from local-first API
      const response = await fetch('/api/print-jobs-sync/');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch print jobs: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Transform and sort by time_submitted descending
      const transformedJobs = data
        .map(job => transformPrintJobFromDb(job as DbPrintJob))
        .sort((a, b) => new Date(b.timeSubmitted).getTime() - new Date(a.timeSubmitted).getTime());

      setPrintJobs(transformedJobs);
    } catch (error: any) {
      console.error('Error fetching print jobs:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load print jobs from database.",
        variant: "destructive",
      });
      // Set empty array for error scenarios
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
      // Create via local-first API
      const response = await fetch('/api/print-jobs-sync/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
          progress_percentage: 0
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create print job: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to create print job');
      }

      const newJob = transformPrintJobFromDb(result.print_job as DbPrintJob);

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

      // Update via local-first API
      const response = await fetch(`/api/print-jobs-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update print job: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to update print job');
      }

      const updatedJob = transformPrintJobFromDb(result.print_job as DbPrintJob);

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
      console.log(`Deleting print job: ${id}`);
      
      // Delete via local-first API with increased timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`/api/print-jobs-sync/${id}`, {
        method: 'DELETE',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Server reported failure to delete print job');
      }

      // Remove from local state immediately for responsive UI
      setPrintJobs(prev => prev.filter(job => job.id !== id));
      
      console.log(`Successfully deleted print job: ${id}`);
      
      // Success toast will be shown by CancelJobModal
    } catch (error) {
      console.error('Error deleting print job:', error);
      
      if (error.name === 'AbortError') {
        throw new Error('Delete request timed out. Please try again.');
      }
      
      // Re-throw the error so CancelJobModal can handle it
      throw error;
    }
  };

  const cancelPrintJob = async (id: string, reason?: string) => {
    try {
      // Cancel via local-first API (using update)
      const response = await fetch(`/api/print-jobs-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          status: 'cancelled',
          failure_reason: reason,
          time_completed: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel print job: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to cancel print job');
      }

      const updatedJob = transformPrintJobFromDb(result.print_job as DbPrintJob);

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

  // Set up real-time subscription for print job changes
  useEffect(() => {
    if (!tenant?.id) {
      console.log('usePrintJobs: No tenant ID, skipping subscription');
      return;
    }

    console.log('usePrintJobs: Setting up real-time subscription for tenant:', tenant.id);
    fetchPrintJobs();

    const channel = supabase
      .channel('print-job-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'print_jobs',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('🆕 Print job inserted via real-time:', payload);
          const newJob = transformPrintJobFromDb(payload.new as DbPrintJob);
          setPrintJobs(prev => {
            console.log('Adding new job to list:', newJob);
            return [newJob, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'print_jobs',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('📝 Print job updated via real-time:', payload);
          const updatedJob = transformPrintJobFromDb(payload.new as DbPrintJob);
          setPrintJobs(prev => {
            console.log('Updating job in list:', updatedJob);
            return prev.map(job => 
              job.id === updatedJob.id ? updatedJob : job
            );
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'print_jobs',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Print job deleted:', payload);
          setPrintJobs(prev => prev.filter(job => job.id !== payload.old.id));
        }
      )
      .subscribe((status) => {
        console.log('Print jobs subscription status:', status);
      });

    return () => {
      console.log('Cleaning up print jobs subscription');
      supabase.removeChannel(channel);
    };
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