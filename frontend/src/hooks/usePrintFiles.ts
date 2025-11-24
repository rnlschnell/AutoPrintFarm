import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError, getApiBaseUrl } from '@/lib/api-client';
import {
  FrontendPrintFile,
  transformPrintFileFromDb,
  transformPrintFileToDb,
} from '@/lib/transformers';
import type { PrintFile as ApiPrintFile } from '@/types/api';

export type { FrontendPrintFile as PrintFile };

export const usePrintFiles = () => {
  const [printFiles, setPrintFiles] = useState<FrontendPrintFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenantId } = useAuth();

  const fetchPrintFiles = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      // Get all print files from Cloud API
      const response = await api.get<(ApiPrintFile & { thumbnail_url?: string })[]>('/api/v1/files', {
        params: {
          limit: 200,
          sortBy: 'created_at',
          sortOrder: 'desc'
        }
      });

      if (!Array.isArray(response)) {
        throw new Error('Invalid response from server');
      }

      // Transform to frontend format
      const transformedFiles = response.map(transformPrintFileFromDb);

      setPrintFiles(transformedFiles);
    } catch (error) {
      console.error('Error fetching print files:', error);
      if (error instanceof ApiError && error.isAuthError()) {
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load print files.",
        variant: "destructive",
      });
      setPrintFiles([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  const addPrintFile = async (fileData: {
    name: string;
    fileSizeBytes?: number;
    numberOfUnits?: number;
    productId?: string;
  }) => {
    try {
      // Create print file via Cloud API
      const response = await api.post<ApiPrintFile>('/api/v1/files', {
        name: fileData.name,
        file_size_bytes: fileData.fileSizeBytes,
        number_of_units: fileData.numberOfUnits || 1,
        product_id: fileData.productId
      });

      const transformedFile = transformPrintFileFromDb(response);

      setPrintFiles(prev => [transformedFile, ...prev]);
      toast({
        title: "Success",
        description: `${fileData.name} has been added to your library.`,
      });

      return transformedFile;
    } catch (error) {
      console.error('Error adding print file:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add print file.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrintFile = async (id: string, updates: Partial<FrontendPrintFile>) => {
    try {
      const updateData = transformPrintFileToDb(updates);

      // Update via Cloud API
      const response = await api.put<ApiPrintFile>(`/api/v1/files/${id}`, updateData);

      const transformedFile = transformPrintFileFromDb(response);
      setPrintFiles(prev => prev.map(file =>
        file.id === id ? transformedFile : file
      ));

      toast({
        title: "Success",
        description: "Print file updated successfully.",
      });

      return transformedFile;
    } catch (error) {
      console.error('Error updating print file:', error);
      toast({
        title: "Error",
        description: "Failed to update print file.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deletePrintFile = async (id: string) => {
    try {
      // Delete via Cloud API (also deletes from R2)
      await api.delete(`/api/v1/files/${id}`);

      setPrintFiles(prev => prev.filter(file => file.id !== id));
      toast({
        title: "Success",
        description: "Print file deleted successfully.",
      });
    } catch (error) {
      console.error('Error deleting print file:', error);
      toast({
        title: "Error",
        description: "Failed to delete print file.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Get presigned upload URL
  const getUploadUrl = async (fileName: string, contentType: string = 'application/octet-stream'): Promise<{
    uploadUrl: string;
    token: string;
    fileId: string;
  }> => {
    try {
      const response = await api.post<{
        upload_url: string;
        token: string;
        file_id: string;
      }>('/api/v1/files/upload-url', {
        file_name: fileName,
        content_type: contentType
      });

      return {
        uploadUrl: response.upload_url,
        token: response.token,
        fileId: response.file_id
      };
    } catch (error) {
      console.error('Error getting upload URL:', error);
      throw error;
    }
  };

  // Upload file using presigned URL
  const uploadFile = async (file: File, onProgress?: (progress: number) => void): Promise<FrontendPrintFile> => {
    try {
      // Get presigned upload URL
      const { uploadUrl, fileId } = await getUploadUrl(file.name, file.type || 'application/octet-stream');

      // Upload to presigned URL
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      // File record is already created, fetch it
      const fileResponse = await api.get<ApiPrintFile & { thumbnail_url?: string }>(`/api/v1/files/${fileId}`);

      const transformedFile = transformPrintFileFromDb(fileResponse);

      setPrintFiles(prev => [transformedFile, ...prev]);
      toast({
        title: "Success",
        description: `${file.name} has been uploaded.`,
      });

      if (onProgress) {
        onProgress(100);
      }

      return transformedFile;
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Get download URL for a file
  const getDownloadUrl = async (id: string): Promise<string> => {
    try {
      const response = await api.get<{ download_url: string }>(`/api/v1/files/${id}/download-url`);
      return response.download_url;
    } catch (error) {
      console.error('Error getting download URL:', error);
      throw error;
    }
  };

  // Get thumbnail URL for a file
  const getThumbnailUrl = (id: string): string => {
    return `${getApiBaseUrl()}/api/v1/files/${id}/thumbnail`;
  };

  // Get file versions
  const getFileVersions = async (id: string) => {
    try {
      const response = await api.get<Array<{
        id: string;
        version_number: number;
        file_url: string | null;
        r2_key: string | null;
        notes: string | null;
        is_current_version: boolean;
        created_at: string;
      }>>(`/api/v1/files/${id}/versions`);
      return response;
    } catch (error) {
      console.error('Error getting file versions:', error);
      throw error;
    }
  };

  // Add a new version to a file
  const addFileVersion = async (id: string, file: File, notes?: string) => {
    try {
      // Get upload URL for new version
      const { uploadUrl } = await getUploadUrl(file.name, file.type || 'application/octet-stream');

      // Upload file
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file version');
      }

      // Create version record
      await api.post(`/api/v1/files/${id}/versions`, {
        notes
      });

      toast({
        title: "Success",
        description: "New version added.",
      });

      // Refresh file list
      await fetchPrintFiles();
    } catch (error) {
      console.error('Error adding file version:', error);
      toast({
        title: "Error",
        description: "Failed to add file version.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Set a version as current
  const setCurrentVersion = async (fileId: string, versionNumber: number) => {
    try {
      await api.put(`/api/v1/files/${fileId}/versions/${versionNumber}/current`);

      toast({
        title: "Success",
        description: `Version ${versionNumber} set as current.`,
      });

      await fetchPrintFiles();
    } catch (error) {
      console.error('Error setting current version:', error);
      toast({
        title: "Error",
        description: "Failed to set current version.",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    if (tenantId) {
      fetchPrintFiles();
    }
  }, [tenantId, fetchPrintFiles]);

  return {
    printFiles,
    loading,
    addPrintFile,
    updatePrintFile,
    deletePrintFile,
    getUploadUrl,
    uploadFile,
    getDownloadUrl,
    getThumbnailUrl,
    getFileVersions,
    addFileVersion,
    setCurrentVersion,
    refetch: fetchPrintFiles
  };
};
