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

export interface PrintFileVersion {
  id: string;
  printFileId: string;
  versionNumber?: number;
  fileUrl?: string;
  notes?: string;
  isCurrentVersion?: boolean;
  createdAt?: string;
}

export interface ExtendedPrintFile extends FrontendPrintFile {
  versions: PrintFileVersion[];
}

export const usePrintFiles = () => {
  const [printFiles, setPrintFiles] = useState<ExtendedPrintFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const fetchPrintFiles = async () => {
    if (!tenant?.id) return;
    
    try {
      const { data: filesData, error: filesError } = await supabase
        .from('print_files')
        .select('*')
        .eq('tenant_id', tenant?.id)
        .order('created_at', { ascending: false });

      if (filesError) throw filesError;

      const { data: versionsData, error: versionsError } = await supabase
        .from('print_file_versions')
        .select('*')
        .order('version_number', { ascending: false });

      if (versionsError) throw versionsError;

      // Combine files with their versions
      const extendedFiles: ExtendedPrintFile[] = (filesData || []).map(file => {
        const fileVersions = (versionsData || []).filter(v => v.print_file_id === file.id);
        const transformedFile = transformPrintFileFromDb(file as DbPrintFile);
        return {
          ...transformedFile,
          versions: fileVersions.map(v => ({
            id: v.id,
            printFileId: v.print_file_id,
            versionNumber: v.version_number,
            fileUrl: v.file_url,
            notes: v.notes,
            isCurrentVersion: v.is_current_version,
            createdAt: v.created_at
          }))
        };
      });

      setPrintFiles(extendedFiles);
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
      const insertData = {
        name: fileData.name,
        file_size_bytes: fileData.fileSizeBytes,
        number_of_units: fileData.numberOfUnits || 1,
        tenant_id: tenant?.id
      };

      const { data: newFile, error: fileError } = await supabase
        .from('print_files')
        .insert(insertData)
        .select()
        .single();

      if (fileError) throw fileError;

      // Create initial version
      const { data: newVersion, error: versionError } = await supabase
        .from('print_file_versions')
        .insert({
          print_file_id: newFile.id,
          version_number: 1,
          notes: fileData.notes || "Initial upload",
          is_current_version: true
        })
        .select()
        .single();

      if (versionError) throw versionError;

      const transformedFile = transformPrintFileFromDb(newFile as DbPrintFile);
      const extendedFile: ExtendedPrintFile = {
        ...transformedFile,
        versions: [{
          id: newVersion.id,
          printFileId: newVersion.print_file_id,
          versionNumber: newVersion.version_number,
          fileUrl: newVersion.file_url,
          notes: newVersion.notes,
          isCurrentVersion: newVersion.is_current_version,
          createdAt: newVersion.created_at
        }]
      };

      setPrintFiles(prev => [extendedFile, ...prev]);
      toast({
        title: "Success",
        description: `${fileData.name} has been added to your library.`,
      });

      return extendedFile;
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
      const { data, error } = await supabase
        .from('print_files')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

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

  const updateFileVersion = async (fileId: string, versionId: string, updates: { notes?: string; isCurrentVersion?: boolean }) => {
    try {
      const updateData = {
        notes: updates.notes,
        is_current_version: updates.isCurrentVersion
      };

      const { data, error } = await supabase
        .from('print_file_versions')
        .update(updateData)
        .eq('id', versionId)
        .select()
        .single();

      if (error) throw error;

      // Refresh the entire file list to get updated version info
      await fetchPrintFiles();

      toast({
        title: "Success",
        description: "File version updated successfully.",
      });

      return data;
    } catch (error) {
      console.error('Error updating file version:', error);
      toast({
        title: "Error",
        description: "Failed to update file version.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deletePrintFile = async (id: string) => {
    try {
      const { error } = await supabase
        .from('print_files')
        .delete()
        .eq('id', id);

      if (error) throw error;

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

  const setFileVersionAsCurrent = async (fileId: string, versionId: string) => {
    try {
      // Get all versions for this file
      const fileVersions = printFiles.find(f => f.id === fileId)?.versions || [];
      
      // Update all versions in the database directly
      await Promise.all(
        fileVersions.map(async (v) => {
          const { error } = await supabase
            .from('print_file_versions')
            .update({ is_current_version: v.id === versionId })
            .eq('id', v.id);
          
          if (error) throw error;
        })
      );

      // Refresh the entire file list to get updated version info
      await fetchPrintFiles();

      toast({
        title: "Success",
        description: "File version updated successfully.",
      });
    } catch (error) {
      console.error('Error setting file version as current:', error);
      toast({
        title: "Error",
        description: "Failed to update file version.",
        variant: "destructive",
      });
      throw error;
    }
  };

  return {
    printFiles,
    loading,
    addPrintFile,
    updatePrintFile,
    updateFileVersion,
    deletePrintFile,
    setFileVersionAsCurrent,
    refetch: fetchPrintFiles
  };
};