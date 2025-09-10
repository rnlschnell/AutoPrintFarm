import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { tempFileManager, TempFile } from '@/lib/tempFileManager';

interface DeferredImageUploadProps {
  currentImageUrl?: string;
  onImageChange: (tempFileId: string | null, previewUrl: string | null) => void;
  label?: string;
  value?: string | null; // Temp file ID or actual URL
}

const DeferredImageUpload = ({ 
  currentImageUrl, 
  onImageChange, 
  label = "Image",
  value
}: DeferredImageUploadProps) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null);
  const [tempFileId, setTempFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Reset preview when currentImageUrl changes (for modal reset)
  useEffect(() => {
    if (value?.startsWith('temp_')) {
      // This is a temp file ID
      const tempFile = tempFileManager.getTempFile(value);
      if (tempFile) {
        setPreviewUrl(tempFile.url || null);
        setTempFileId(value);
      }
    } else {
      setPreviewUrl(currentImageUrl || null);
      setTempFileId(null);
    }
  }, [currentImageUrl, value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tempFileId) {
        tempFileManager.removeTempFile(tempFileId);
      }
    };
  }, []);

  const validateFile = (file: File): void => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Only JPG, JPEG, and PNG files are allowed');
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB
      throw new Error('File size must be less than 10MB');
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateFile(file);

      // Clean up previous temp file if exists
      if (tempFileId) {
        tempFileManager.removeTempFile(tempFileId);
      }

      // Create temporary file
      const tempFile = tempFileManager.addTempImage(file, currentImageUrl);
      
      // Update state
      setPreviewUrl(tempFile.url || null);
      setTempFileId(tempFile.id);
      
      // Notify parent
      onImageChange(tempFile.id, tempFile.url || null);
    } catch (error) {
      console.error('File selection error:', error);
      toast({
        title: "Invalid File",
        description: error instanceof Error ? error.message : "Failed to select image",
        variant: "destructive",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    // Clean up temp file if exists
    if (tempFileId) {
      tempFileManager.removeTempFile(tempFileId);
      setTempFileId(null);
    }

    setPreviewUrl(null);
    onImageChange(null, null);
  };

  return (
    <div className="space-y-4">
      <Label>{label}</Label>
      
      {previewUrl ? (
        <div className="relative group">
          <img 
            src={previewUrl} 
            alt="Preview" 
            className="w-full h-24 object-cover rounded-md border"
          />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRemoveImage}
            >
              <X className="h-4 w-4 mr-1" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div 
          className="border-2 border-dashed border-muted-foreground/25 rounded-md p-4 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground mb-1">
            Click to upload an image
          </p>
          <p className="text-xs text-muted-foreground/75">
            JPG, JPEG, PNG up to 10MB
          </p>
          <Button 
            size="sm" 
            variant="outline" 
            className="mt-2 h-7 text-xs"
          >
            <Upload className="h-3 w-3 mr-1" />
            Select Image
          </Button>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};

export default DeferredImageUpload;