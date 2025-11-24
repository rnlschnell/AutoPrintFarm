import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, File, Trash2, Plus } from 'lucide-react';
import { tempFileManager } from '@/lib/tempFileManager';
import { parseFileMetadata, getPrinterModelLabel } from '@/services/metadataParser';

export interface PrintFileEntry {
  id: string; // temp file ID or actual print file ID
  printerModelCode: string | null; // Bambu code (N1, N2S, P1P, etc.) or null for default
  fileName: string;
  isTemp: boolean; // true if this is a temp file pending upload
}

interface ProductPrintFilesManagerProps {
  productId?: string; // Existing product ID (for editing)
  existingFiles?: PrintFileEntry[]; // Files already uploaded for this product
  onFilesChange: (files: PrintFileEntry[]) => void; // Callback when files change
  onViewDetails?: (fileId: string) => void; // Callback when user wants to view file details
  readOnly?: boolean; // Read-only mode (view only)
}

export const ProductPrintFilesManager = ({
  productId,
  existingFiles = [],
  onFilesChange,
  onViewDetails,
  readOnly = false
}: ProductPrintFilesManagerProps) => {
  const [files, setFiles] = useState<PrintFileEntry[]>(existingFiles);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Sync external changes to internal state
  useEffect(() => {
    setFiles(existingFiles);
  }, [existingFiles]);

  // Get models that are already used
  const usedModelCodes = new Set(files.map(f => f.printerModelCode));

  const validateFile = (file: globalThis.File): void => {
    const allowedTypes = ['.stl', '.gcode', '.3mf', '.obj', '.amf'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(fileExtension)) {
      throw new Error('Only STL, GCODE, 3MF, OBJ, and AMF files are allowed');
    }

    if (file.size > 100 * 1024 * 1024) { // 100MB limit
      throw new Error('File size must be less than 100MB');
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      validateFile(file);

      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      let modelCode: string | null = null;

      // Auto-extract printer model from 3MF files
      if (fileExtension === '.3mf') {
        try {
          const metadata = await parseFileMetadata(file);
          modelCode = metadata.printer_model_id;
        } catch (parseError) {
          console.warn('Failed to parse metadata from 3MF file:', parseError);
          toast({
            title: "Auto-Detection Failed",
            description: "Could not detect printer model from file. Please select the model manually or contact support.",
            variant: "destructive",
          });
          setUploading(false);
          event.target.value = '';
          return;
        }
      } else {
        // For non-3MF files, we can't auto-detect model
        // For now, set to null (default/all models)
        // Future enhancement: show a model selector dialog for non-3MF files
        modelCode = null;
        toast({
          title: "File Added",
          description: `Added ${file.name} (non-3MF files default to all models)`,
          variant: "default",
        });
      }

      // Check if this model is already used
      if (usedModelCodes.has(modelCode)) {
        toast({
          title: "Model Already Exists",
          description: `A file for ${getPrinterModelLabel(modelCode)} already exists. Please remove it first.`,
          variant: "destructive",
        });
        event.target.value = '';
        setUploading(false);
        return;
      }

      // Create temporary file with detected model
      const fileName = file.name;
      const tempFileId = crypto.randomUUID();
      tempFileManager.add(tempFileId, file);

      // Add to files list
      const newFile: PrintFileEntry = {
        id: tempFileId,
        printerModelCode: modelCode,
        fileName: fileName,
        isTemp: true
      };

      const updatedFiles = [...files, newFile];
      setFiles(updatedFiles);
      onFilesChange(updatedFiles);

    } catch (error) {
      console.error('File selection error:', error);
      toast({
        title: "Invalid File",
        description: error instanceof Error ? error.message : "Failed to select file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleRemoveFile = (fileId: string) => {
    const fileToRemove = files.find(f => f.id === fileId);

    if (fileToRemove?.isTemp) {
      // Remove temp file from manager
      tempFileManager.remove(fileId);
    }

    // Remove from list
    const updatedFiles = files.filter(f => f.id !== fileId);
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);

    toast({
      title: "File Removed",
      description: `Removed ${fileToRemove?.fileName}`,
      variant: "default",
    });
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Print Files by Printer Model</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Upload 3MF files and the printer model will be automatically detected. At least one file is required.
        </p>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.gcode,.3mf,.obj,.amf"
        onChange={handleFileSelect}
        className="hidden"
        id="print-file-upload-auto"
        disabled={uploading || readOnly}
      />

      {/* Files List with Add Button */}
      <div className="space-y-2">
        {files.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-muted-foreground/25 rounded-md">
            <File className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-4">
              {readOnly ? 'No print files uploaded' : 'No print files yet. Add at least one file to continue.'}
            </p>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                onClick={triggerFileInput}
                disabled={uploading}
                className="mx-auto"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload First File
                  </>
                )}
              </Button>
            )}
          </div>
        ) : (
          <>
            {files.map((file) => (
              <div
                key={file.id}
                className={`flex items-center justify-between p-3 border rounded-md ${
                  file.isTemp ? 'border-blue-200 bg-blue-50' : 'border-green-200 bg-green-50'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {getPrinterModelLabel(file.printerModelCode)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{file.fileName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* See File Details Button - only show for non-temp files */}
                  {!file.isTemp && onViewDetails && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onViewDetails(file.id)}
                      className="flex-shrink-0"
                    >
                      See File Details
                    </Button>
                  )}
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(file.id)}
                      className="text-destructive hover:text-destructive flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Add Another File Button */}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                onClick={triggerFileInput}
                disabled={uploading}
                className="w-full border-2 border-dashed"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another File
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>

    </div>
  );
};
