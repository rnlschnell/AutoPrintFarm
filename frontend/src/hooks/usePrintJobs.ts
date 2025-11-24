import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  FrontendPrintJob,
  transformPrintJobFromDb,
  transformPrintJobToDb,
} from '@/lib/transformers';
import type { PrintJob as ApiPrintJob, JobStats } from '@/types/api';

export type { FrontendPrintJob as PrintJob };

export const usePrintJobs = () => {
  const [printJobs, setPrintJobs] = useState<FrontendPrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenantId } = useAuth();

  const fetchPrintJobs = useCallback(async (filters?: {
    status?: string;
    printer_id?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch from Cloud API
      const response = await api.get<ApiPrintJob[]>('/api/v1/jobs', {
        params: {
          limit: 100,
          sortBy: 'time_submitted',
          sortOrder: 'desc',
          ...filters
        }
      });

      if (!Array.isArray(response)) {
        throw new Error('Invalid response from server');
      }

      // Transform to frontend format
      const transformedJobs = response.map(transformPrintJobFromDb);

      setPrintJobs(transformedJobs);
    } catch (error) {
      console.error('Error fetching print jobs:', error);
      if (error instanceof ApiError && error.isAuthError()) {
        return;
      }
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load print jobs.",
        variant: "destructive",
      });
      setPrintJobs([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  const addPrintJob = async (jobData: {
    printerId?: string;
    printFileId: string;
    productSkuId?: string;
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
      // Create via Cloud API
      const response = await api.post<ApiPrintJob>('/api/v1/jobs', {
        printer_id: jobData.printerId,
        print_file_id: jobData.printFileId,
        product_sku_id: jobData.productSkuId,
        file_name: jobData.fileName,
        color: jobData.color,
        filament_type: jobData.filamentType,
        material_type: jobData.materialType,
        number_of_units: jobData.numberOfUnits || 1,
        filament_needed_grams: jobData.filamentNeededGrams,
        estimated_print_time_minutes: jobData.estimatedPrintTimeMinutes,
        priority: jobData.priority || 0,
      });

      const newJob = transformPrintJobFromDb(response);

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
        description: error instanceof Error ? error.message : "Failed to create print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrintJob = async (id: string, updates: Partial<FrontendPrintJob>) => {
    try {
      const updateData = transformPrintJobToDb(updates);

      // Update via Cloud API
      const response = await api.put<ApiPrintJob>(`/api/v1/jobs/${id}`, updateData);

      const updatedJob = transformPrintJobFromDb(response);

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
      // Delete via Cloud API
      await api.delete(`/api/v1/jobs/${id}`);

      // Remove from local state
      setPrintJobs(prev => prev.filter(job => job.id !== id));

      toast({
        title: "Success",
        description: "Print job deleted.",
      });
    } catch (error) {
      console.error('Error deleting print job:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete print job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const cancelPrintJob = async (id: string, reason?: string) => {
    try {
      // Cancel via Cloud API
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/cancel`, {
        failure_reason: reason
      });

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print job cancelled.",
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

  // Job control methods
  const assignJob = async (id: string, printerId: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/assign`, {
        printer_id: printerId
      });

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Job assigned to printer.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error assigning job:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to assign job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const startJob = async (id: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/start`);

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print job started.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error starting job:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start print.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const pauseJob = async (id: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/pause`);

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print paused.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error pausing job:', error);
      toast({
        title: "Error",
        description: "Failed to pause print.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const resumeJob = async (id: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/resume`);

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print resumed.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error resuming job:', error);
      toast({
        title: "Error",
        description: "Failed to resume print.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const completeJob = async (id: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/complete`);

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Print marked as completed.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error completing job:', error);
      toast({
        title: "Error",
        description: "Failed to complete print.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const failJob = async (id: string, reason?: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/fail`, {
        failure_reason: reason
      });

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Job Failed",
        description: reason || "Print job marked as failed.",
        variant: "destructive",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error failing job:', error);
      toast({
        title: "Error",
        description: "Failed to update job status.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const retryJob = async (id: string) => {
    try {
      const response = await api.post<ApiPrintJob>(`/api/v1/jobs/${id}/retry`);

      const updatedJob = transformPrintJobFromDb(response);

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? updatedJob : job
      ));

      toast({
        title: "Success",
        description: "Job re-queued for printing.",
      });

      return updatedJob;
    } catch (error) {
      console.error('Error retrying job:', error);
      toast({
        title: "Error",
        description: "Failed to retry job.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateProgress = async (id: string, progress: number) => {
    try {
      await api.put(`/api/v1/jobs/${id}/progress`, {
        progress_percentage: progress
      });

      setPrintJobs(prev => prev.map(job =>
        job.id === id ? { ...job, progressPercentage: progress } : job
      ));
    } catch (error) {
      console.error('Error updating progress:', error);
      // Silent fail for progress updates
    }
  };

  // Get job statistics
  const getJobStats = async (): Promise<JobStats | null> => {
    try {
      const response = await api.get<JobStats>('/api/v1/jobs/stats');
      return response;
    } catch (error) {
      console.error('Error fetching job stats:', error);
      return null;
    }
  };

  // Initial fetch
  useEffect(() => {
    if (tenantId) {
      fetchPrintJobs();
    }
  }, [tenantId, fetchPrintJobs]);

  return {
    printJobs,
    loading,
    addPrintJob,
    updatePrintJob,
    deletePrintJob,
    cancelPrintJob,
    assignJob,
    startJob,
    pauseJob,
    resumeJob,
    completeJob,
    failJob,
    retryJob,
    updateProgress,
    getJobStats,
    refetch: fetchPrintJobs
  };
};
