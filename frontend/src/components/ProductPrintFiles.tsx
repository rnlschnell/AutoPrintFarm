import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, Star, StarOff, Trash2, Plus, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { usePrintFiles, PrintFileVersion, ExtendedPrintFile } from '@/hooks/usePrintFiles';

interface ProductPrintFilesProps {
  productId?: string;
  tenantId: string;
  initialFiles?: ExtendedPrintFile[];
  onFilesChange?: (files: ExtendedPrintFile[]) => void;
  readOnly?: boolean;
}

/**
 * @deprecated This component immediately uploads files to storage.
 * Use DeferredPrintFileUpload for better UX that defers uploads until save.
 */

export const ProductPrintFiles = ({ productId, tenantId, initialFiles = [], onFilesChange, readOnly = false }: ProductPrintFilesProps) => {
  const [files, setFiles] = useState<ExtendedPrintFile[]>(initialFiles);
  const [newFileName, setNewFileName] = useState('');
  const [newFileNotes, setNewFileNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { addPrintFile, updateFileVersion, setFileVersionAsCurrent, deletePrintFile } = usePrintFiles();

  useEffect(() => {
    setFiles(initialFiles);
  }, [initialFiles]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !newFileName.trim()) {
      toast({
        title: "Error",
        description: "Please provide a file name and select a file.",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploading(true);

      // Validate file type (common 3D file formats)
      const allowedTypes = ['.stl', '.obj', '.3mf', '.gcode', '.amf'];
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!allowedTypes.includes(fileExtension)) {
        throw new Error('Only STL, OBJ, 3MF, GCODE, and AMF files are allowed');
      }

      // Upload file to storage
      const fileName = `${tenantId}/print-files/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('inventory-photos') // Using existing bucket
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('inventory-photos')
        .getPublicUrl(uploadData.path);

      // Create print file record
      const newFile = await addPrintFile({
        name: newFileName,
        fileSizeBytes: file.size,
        numberOfUnits: 1,
        notes: newFileNotes || "Initial upload"
      });

      // Update the first version with the file URL
      if (newFile.versions.length > 0) {
        await updateFileVersion(newFile.id, newFile.versions[0].id, {
          notes: newFileNotes || "Initial upload"
        });

        // Update the file URL in the database
        const { error: updateError } = await supabase
          .from('print_file_versions')
          .update({ file_url: publicUrl })
          .eq('id', newFile.versions[0].id);

        if (updateError) throw updateError;
      }

      // Update local state
      const updatedFile = {
        ...newFile,
        versions: newFile.versions.map(v => ({ ...v, fileUrl: publicUrl }))
      };
      const updatedFiles = [...files, updatedFile];
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);

      // Reset form
      setNewFileName('');
      setNewFileNotes('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      toast({
        title: "Success",
        description: "Print file uploaded successfully.",
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAddVersion = async (fileId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);

      // Check if file already has 3 versions
      const existingFile = files.find(f => f.id === fileId);
      if (existingFile && existingFile.versions.length >= 3) {
        toast({
          title: "Error",
          description: "Maximum of 3 versions allowed per file.",
          variant: "destructive",
        });
        return;
      }

      // Upload new version
      const fileName = `${tenantId}/print-files/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('inventory-photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('inventory-photos')
        .getPublicUrl(uploadData.path);

      // Create new version
      const nextVersionNumber = Math.max(...(existingFile?.versions.map(v => v.versionNumber || 0) || [0])) + 1;
      const { data: newVersion, error: versionError } = await supabase
        .from('print_file_versions')
        .insert({
          print_file_id: fileId,
          version_number: nextVersionNumber,
          file_url: publicUrl,
          notes: `Version ${nextVersionNumber}`,
          is_current_version: false
        })
        .select()
        .single();

      if (versionError) throw versionError;

      // Update local state
      const updatedFiles = files.map(f => 
        f.id === fileId 
          ? {
              ...f,
              versions: [...f.versions, {
                id: newVersion.id,
                printFileId: newVersion.print_file_id,
                versionNumber: newVersion.version_number,
                fileUrl: newVersion.file_url,
                notes: newVersion.notes,
                isCurrentVersion: newVersion.is_current_version,
                createdAt: newVersion.created_at
              }]
            }
          : f
      );
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);

      toast({
        title: "Success",
        description: "New version uploaded successfully.",
      });
    } catch (error) {
      console.error('Error uploading version:', error);
      toast({
        title: "Error",
        description: "Failed to upload new version",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSetAsCurrent = async (fileId: string, versionId: string) => {
    try {
      await setFileVersionAsCurrent(fileId, versionId);
      
      // Update local state
      const updatedFiles = files.map(f => 
        f.id === fileId 
          ? {
              ...f,
              versions: f.versions.map(v => ({
                ...v,
                isCurrentVersion: v.id === versionId
              }))
            }
          : f
      );
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);
    } catch (error) {
      console.error('Error setting version as current:', error);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await deletePrintFile(fileId);
      const updatedFiles = files.filter(f => f.id !== fileId);
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Print Files
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="files" className="w-full">
          <TabsList className={`grid w-full ${readOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <TabsTrigger value="files">Files ({files.length})</TabsTrigger>
            {!readOnly && <TabsTrigger value="upload">Upload New</TabsTrigger>}
          </TabsList>
          
          <TabsContent value="files" className="space-y-4">
            {files.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No print files uploaded yet.</p>
                <p className="text-sm">Use the "Upload New" tab to add files.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {files.map((file) => (
                  <div key={file.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium">{file.name}</h4>
                      {!readOnly && (
                        <Button
                          onClick={() => handleDeleteFile(file.id)}
                          size="sm"
                          variant="destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Versions ({file.versions.length}/3)
                      </p>
                      
                      {file.versions.map((version) => (
                        <div key={version.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-md">
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="text-sm font-medium">
                                Version {version.versionNumber}
                                {version.isCurrentVersion && (
                                  <Badge variant="default" className="ml-2">Current</Badge>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{version.notes}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {version.fileUrl && (
                              <Button
                                onClick={() => window.open(version.fileUrl, '_blank')}
                                size="sm"
                                variant="outline"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                            {!readOnly && (
                              <Button
                                onClick={() => handleSetAsCurrent(file.id, version.id)}
                                size="sm"
                                variant={version.isCurrentVersion ? "default" : "outline"}
                                disabled={version.isCurrentVersion}
                              >
                                {version.isCurrentVersion ? (
                                  <Star className="h-4 w-4" />
                                ) : (
                                  <StarOff className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      
                      {!readOnly && file.versions.length < 3 && (
                        <div className="mt-2">
                          <input
                            type="file"
                            accept=".stl,.obj,.3mf,.gcode,.amf"
                            onChange={(e) => handleAddVersion(file.id, e)}
                            className="hidden"
                            id={`add-version-${file.id}`}
                          />
                          <Button
                            onClick={() => document.getElementById(`add-version-${file.id}`)?.click()}
                            size="sm"
                            variant="outline"
                            disabled={uploading}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add Version
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          
          {!readOnly && (
            <TabsContent value="upload" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fileName">File Name *</Label>
                  <Input
                    id="fileName"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="Enter file name"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="fileNotes">Notes</Label>
                  <Textarea
                    id="fileNotes"
                    value={newFileNotes}
                    onChange={(e) => setNewFileNotes(e.target.value)}
                    placeholder="Optional notes about this file..."
                    rows={3}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="file">Select File *</Label>
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-4 text-center">
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept=".stl,.obj,.3mf,.gcode,.amf"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                    <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground mb-2">
                      STL, OBJ, 3MF, GCODE, AMF files
                    </p>
                    <Button 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || !newFileName.trim()}
                      variant="outline"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {uploading ? 'Uploading...' : 'Select File'}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};