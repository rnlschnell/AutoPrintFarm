import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import imageCompression from 'browser-image-compression';

interface ImageUploadProps {
  currentImageUrl?: string;
  onImageUpload: (imageUrl: string | null) => void;
  label?: string;
  tenantId: string;
}

/**
 * @deprecated This component immediately uploads files to storage.
 * Use DeferredImageUpload for better UX that defers uploads until save.
 */

const ImageUpload = ({ currentImageUrl, onImageUpload, label = "Image", tenantId }: ImageUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Reset preview when currentImageUrl changes (for modal reset)
  useEffect(() => {
    setPreviewUrl(currentImageUrl || null);
  }, [currentImageUrl]);

  // Cleanup object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 0.1, // Target ~100KB
      maxWidthOrHeight: 800,
      useWebWorker: true,
      initialQuality: 0.7,
    };
    
    try {
      return await imageCompression(file, options);
    } catch (error) {
      console.error('Error compressing image:', error);
      throw error;
    }
  };

  const uploadImage = async (file: File): Promise<string> => {
    // Validate file
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Only JPG, JPEG, and PNG files are allowed');
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB
      throw new Error('File size must be less than 10MB');
    }

    // Compress image
    const compressedFile = await compressImage(file);
    
    // Generate unique filename with tenant isolation
    const fileExt = file.name.split('.').pop();
    const fileName = `${tenantId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('inventory-photos')
      .upload(fileName, compressedFile, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('inventory-photos')
      .getPublicUrl(data.path);

    return publicUrl;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);

      // Create preview
      const preview = URL.createObjectURL(file);
      setPreviewUrl(preview);

      // Upload image
      const imageUrl = await uploadImage(file);
      
      // Update parent component
      onImageUpload(imageUrl);

      toast({
        title: "Success",
        description: "Image uploaded successfully",
      });
    } catch (error) {
      console.error('Upload error:', error);
      setPreviewUrl(currentImageUrl || null);
      
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      // If there's a current image URL, try to delete it from storage
      if (currentImageUrl && currentImageUrl.includes('inventory-photos')) {
        const path = currentImageUrl.split('/').slice(-2).join('/'); // Get tenant/filename
        await supabase.storage
          .from('inventory-photos')
          .remove([path]);
      }

      setPreviewUrl(null);
      onImageUpload(null);

      toast({
        title: "Success",
        description: "Image removed successfully",
      });
    } catch (error) {
      console.error('Error removing image:', error);
      toast({
        title: "Error",
        description: "Failed to remove image",
        variant: "destructive",
      });
    }
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
              disabled={uploading}
            >
              <Upload className="h-4 w-4 mr-1" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRemoveImage}
              disabled={uploading}
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
            disabled={uploading}
          >
            <Upload className="h-3 w-3 mr-1" />
            {uploading ? 'Uploading...' : 'Select Image'}
          </Button>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />
    </div>
  );
};

export default ImageUpload;