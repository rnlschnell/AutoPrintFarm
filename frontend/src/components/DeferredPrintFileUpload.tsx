import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, File, X, Replace, Trash2 } from 'lucide-react';
import { tempFileManager, TempPrintFileData } from '@/lib/tempFileManager';
import { useTenant } from '@/hooks/useTenant';

interface DeferredPrintFileUploadProps {
  currentPrintFileId?: string | null;
  currentPrintFileName?: string;
  onPrintFileChange: (tempFileId: string | null, fileName: string | null) => void;
  value?: string | null; // Temp file ID or actual print file ID
  allowReplace?: boolean; // Allow replacing existing files
  allowDelete?: boolean; // Allow deleting existing files
  onFileReplaced?: (printFileId: string) => void; // Callback when file is replaced
  onFileDeleted?: (printFileId: string) => void; // Callback when file is deleted
}

const DeferredPrintFileUpload = ({ 
  currentPrintFileId,
  currentPrintFileName,
  onPrintFileChange,
  value,
  allowReplace = false,
  allowDelete = false,
  onFileReplaced,
  onFileDeleted
}: DeferredPrintFileUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tempFile, setTempFile] = useState<TempPrintFileData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { tenantId } = useTenant();

  // Check if we have a temp file
  const hasTempFile = value?.startsWith('temp_');
  const displayFileName = hasTempFile ? 
    tempFileManager.getTempPrintFile(value!)?.name : 
    currentPrintFileName;

  const validateFile = (file: File): void => {
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

      // Clean up previous temp file if exists
      if (hasTempFile && value) {
        tempFileManager.removeTempPrintFile(value);
      }

      // Create temporary file with basic name (can be edited later)
      const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
      const tempFileData = tempFileManager.addTempPrintFile(file, fileName, "Uploaded file");
      
      setTempFile(tempFileData);
      onPrintFileChange(tempFileData.id, tempFileData.name);
    } catch (error) {
      console.error('File selection error:', error);
      toast({
        title: "Invalid File",
        description: error instanceof Error ? error.message : "Failed to select file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = () => {
    if (hasTempFile && value) {
      tempFileManager.removeTempPrintFile(value);
    }
    
    setTempFile(null);
    onPrintFileChange(null, null);
  };

  const handleReplaceExistingFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentPrintFileId || !tenantId) return;

    try {
      setReplacing(true);
      validateFile(file);

      await tempFileManager.replaceExistingPrintFile(currentPrintFileId, file, tenantId);
      
      toast({
        title: "File Replaced",
        description: "Print file has been successfully replaced",
        variant: "default",
      });

      if (onFileReplaced) {
        onFileReplaced(currentPrintFileId);
      }
    } catch (error) {
      console.error('File replacement error:', error);
      toast({
        title: "Replacement Failed",
        description: error instanceof Error ? error.message : "Failed to replace file",
        variant: "destructive",
      });
    } finally {
      setReplacing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteExistingFile = async () => {
    if (!currentPrintFileId) return;

    try {
      setDeleting(true);
      
      await tempFileManager.deleteExistingPrintFile(currentPrintFileId);
      
      toast({
        title: "File Deleted",
        description: "Print file has been successfully deleted",
        variant: "default",
      });

      if (onFileDeleted) {
        onFileDeleted(currentPrintFileId);
      }
    } catch (error) {
      console.error('File deletion error:', error);
      toast({
        title: "Deletion Failed",
        description: error instanceof Error ? error.message : "Failed to delete file",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const hasFile = hasTempFile || currentPrintFileId;
  const isProcessing = uploading || replacing || deleting;

  return (
    <div className="space-y-2">
      <Label htmlFor="print_file">Print File</Label>
      <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-3 text-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl,.gcode,.3mf,.obj,.amf"
          onChange={handleFileSelect}
          className="hidden"
          id="print-file-upload"
          disabled={isProcessing}
        />
        
        {/* Hidden input for replace operations */}
        <input
          type="file"
          accept=".stl,.gcode,.3mf,.obj,.amf"
          onChange={handleReplaceExistingFile}
          className="hidden"
          id="print-file-replace"
          disabled={isProcessing}
        />
        
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center gap-2 text-blue-600">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm">
              {uploading && 'Processing...'}
              {replacing && 'Replacing file...'}
              {deleting && 'Deleting file...'}
            </span>
          </div>
        ) : hasFile ? (
          <div className="flex flex-col items-center justify-center gap-2 text-green-600">
            <File className="h-6 w-6" />
            <span className="text-sm font-medium">
              {hasTempFile ? 'File Ready for Upload' : 'File Attached'}
            </span>
            <span className="text-xs text-green-700">
              {displayFileName || 'File attached'}
            </span>
            <div className="flex gap-2 mt-1">
              {hasTempFile ? (
                <>
                  <Button 
                    size="sm"
                    variant="outline" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                  >
                    Replace File
                  </Button>
                  <Button 
                    size="sm"
                    variant="destructive" 
                    onClick={handleRemoveFile}
                    disabled={isProcessing}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  {allowReplace && (
                    <Button 
                      size="sm"
                      variant="outline" 
                      onClick={() => document.getElementById('print-file-replace')?.click()}
                      disabled={isProcessing}
                    >
                      <Replace className="h-4 w-4 mr-1" />
                      Replace
                    </Button>
                  )}
                  {allowDelete && (
                    <Button 
                      size="sm"
                      variant="destructive" 
                      onClick={handleDeleteExistingFile}
                      disabled={isProcessing}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  )}
                  {!allowReplace && !allowDelete && (
                    <Button 
                      size="sm"
                      variant="outline" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing}
                    >
                      Replace File
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground mb-2">
              STL, GCODE, 3MF, OBJ, AMF files
            </p>
            <Button 
              size="sm"
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              Choose File
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default DeferredPrintFileUpload;