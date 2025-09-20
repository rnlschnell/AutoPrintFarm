import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface EnhancedJobRequest {
  job_type: 'print_file' | 'product';
  target_id: string;
  printer_id: string;
  color: string;
  filament_type: string;
  material_type: string;
  copies: number;
  spacing_mm?: number;
  use_ams?: boolean;
  start_print?: boolean;
  priority?: number;
}

export interface ProcessingStatus {
  stage: string;
  file_type: string;
  target_id: string;
  printer_id: string;
  copies: number;
  auto_start: boolean;
}

export interface JobResponse {
  success: boolean;
  message: string;
  job_id?: string;
  processing_status?: ProcessingStatus;
  error_details?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const usePrintJobProcessor = () => {
  const [processing, setProcessing] = useState(false);
  const [validating, setValidating] = useState(false);
  const { toast } = useToast();

  const getApiBaseUrl = () => {
    const currentHost = window.location.hostname;
    
    if (currentHost === '192.168.4.45' || currentHost === 'localhost' || currentHost === '127.0.0.1') {
      return `${window.location.protocol}//${window.location.host}`;
    } else {
      return 'http://192.168.4.45:8080';
    }
  };

  const validateJobRequest = async (request: EnhancedJobRequest): Promise<ValidationResult> => {
    try {
      setValidating(true);
      
      // Get the current session to include auth headers
      const { data: { session } } = await supabase.auth.getSession();
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/enhanced-print-jobs/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Validation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        return data.validation;
      } else {
        throw new Error(data.message || 'Validation failed');
      }
      
    } catch (error: any) {
      console.error('Error validating job request:', error);
      
      // Return a basic validation error
      return {
        valid: false,
        errors: [error.message || 'Failed to validate job request'],
        warnings: []
      };
    } finally {
      setValidating(false);
    }
  };

  const createEnhancedJob = async (request: EnhancedJobRequest): Promise<JobResponse> => {
    try {
      setProcessing(true);
      
      // First validate the request
      const validation = await validateJobRequest(request);
      
      if (!validation.valid) {
        const errorMessage = validation.errors.join(', ');
        toast({
          title: "Validation Error",
          description: errorMessage,
          variant: "destructive",
        });
        
        return {
          success: false,
          message: errorMessage,
          error_details: validation.errors.join('\n')
        };
      }

      // Show warnings if any
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => {
          toast({
            title: "Warning",
            description: warning,
            variant: "default",
          });
        });
      }

      // Get the current session to include auth headers
      const { data: { session } } = await supabase.auth.getSession();
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/enhanced-print-jobs/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        let errorMessage = `Job creation failed: ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If JSON parsing fails, try text
          try {
            const errorText = await response.text();
            if (errorText) {
              errorMessage += ` - ${errorText}`;
            }
          } catch {
            // Ignore text parsing errors
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (data.success) {
        // Don't show toast here - let the component handle it for better control
        console.log('Job created successfully:', data);
        return data;
      } else {
        // Return the error data instead of throwing - let component handle it
        console.error('Job creation failed:', data);
        return {
          success: false,
          message: data.message || 'Job creation failed',
          error_details: data.error_details,
          job_id: data.job_id
        };
      }
      
    } catch (error: any) {
      console.error('Error creating enhanced job:', error);
      
      // Don't show toast here - let component handle it
      return {
        success: false,
        message: error.message || 'Network error - failed to create print job',
        error_details: `Network or communication error: ${error.message}`,
        network_error: true
      };
    } finally {
      setProcessing(false);
    }
  };

  const getJobStatus = async (jobId: string) => {
    try {
      // Get the current session to include auth headers
      const { data: { session } } = await supabase.auth.getSession();
      const headers: any = {};
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/enhanced-print-jobs/status/${jobId}`, {
        headers
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
      
    } catch (error: any) {
      console.error('Error getting job status:', error);
      return null;
    }
  };

  const testConnection = async (): Promise<boolean> => {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      return response.ok;
    } catch (error) {
      console.warn('Pi connection test failed:', error);
      return false;
    }
  };

  return {
    processing,
    validating,
    createEnhancedJob,
    validateJobRequest,
    getJobStatus,
    testConnection
  };
};