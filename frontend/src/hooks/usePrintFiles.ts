import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { 
  FrontendPrintFile, 
  transformPrintFileFromDb, 
  transformPrintFileToDb,
  DbPrintFile 
} from '@/lib/transformers';

export const usePrintFiles = () => {
  const [printFiles, setPrintFiles] = useState<FrontendPrintFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const fetchPrintFiles = async () => {
    if (!tenant?.id) return;
    
    try {
      // Get active products from local-first API
      const productsResponse = await fetch('/api/products-sync/');
      if (!productsResponse.ok) {
        throw new Error(`Failed to fetch products: ${productsResponse.statusText}`);
      }
      const productsData = await productsResponse.json();
      
      // Filter active products with print files
      const activeProducts = productsData.filter(p => p.is_active && p.print_file_id);
      const activePrintFileIds = activeProducts.map(p => p.print_file_id);
      const productFileMap = new Map(activeProducts.map(p => [p.print_file_id, { productName: p.name, originalFileName: p.file_name }]));

      // Get all print files from local-first API
      const printFilesResponse = await fetch('/api/print-files-sync/');
      if (!printFilesResponse.ok) {
        throw new Error(`Failed to fetch print files: ${printFilesResponse.statusText}`);
      }
      const allFilesData = await printFilesResponse.json();
      
      // Filter to only files linked to active products
      const filesData = allFilesData.filter(file => activePrintFileIds.includes(file.id));
      
      // Sort by created_at descending
      filesData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Combine files with friendly names
      const transformedFiles: FrontendPrintFile[] = (filesData || []).map(file => {
        const transformedFile = transformPrintFileFromDb(file as DbPrintFile);
        const productInfo = productFileMap.get(file.id);

        // Use product name + original file name for display
        const displayName = productInfo
          ? `${productInfo.productName} (${productInfo.originalFileName || file.name})`
          : file.name;

        return {
          ...transformedFile,
          name: displayName // Override with friendly name
        };
      });

      setPrintFiles(transformedFiles);
    } catch (error) {
      console.error('Error fetching print files:', error);
      toast({
        title: "Error",
        description: "Failed to load print files from database.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addPrintFile = async (fileData: { 
    name: string; 
    fileSizeBytes?: number;
    numberOfUnits?: number;
    notes?: string;
  }) => {
    try {
      // Create print file via local-first API
      const response = await fetch('/api/print-files-sync/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: fileData.name,
          file_size_bytes: fileData.fileSizeBytes,
          number_of_units: fileData.numberOfUnits || 1
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create print file: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to create print file');
      }
      
      const newFile = result.print_file;

      const transformedFile = transformPrintFileFromDb(newFile as DbPrintFile);

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
        description: "Failed to add print file to database.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrintFile = async (id: string, updates: Partial<FrontendPrintFile>) => {
    try {
      const updateData = transformPrintFileToDb(updates);
      
      // Update via local-first API
      const response = await fetch(`/api/print-files-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update print file: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to update print file');
      }
      
      const data = result.print_file;

      const transformedFile = transformPrintFileFromDb(data as DbPrintFile);
      setPrintFiles(prev => prev.map(file => 
        file.id === id ? { 
          ...file, 
          ...transformedFile
        } : file
      ));

      toast({
        title: "Success",
        description: "Print file updated successfully.",
      });

      return data;
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
      // Delete via local-first API
      const response = await fetch(`/api/print-files-sync/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete print file: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to delete print file');
      }

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

  useEffect(() => {
    if (tenant?.id) {
      fetchPrintFiles();
    }
  }, [tenant?.id]);

  return {
    printFiles,
    loading,
    addPrintFile,
    updatePrintFile,
    deletePrintFile,
    refetch: fetchPrintFiles
  };
};