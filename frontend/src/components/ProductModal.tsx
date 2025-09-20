
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Product, ProductWithDetails } from '@/hooks/useProductsNew';
import { ProductAssemblyComponents } from './ProductAssemblyComponents';
import { SkuManagement } from './SkuManagement';
import DeferredImageUpload from './DeferredImageUpload';
import DeferredPrintFileUpload from './DeferredPrintFileUpload';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { tempFileManager } from '@/lib/tempFileManager';
import { File, Trash2 } from 'lucide-react';

interface ComponentData {
  id?: string;
  component_name: string;
  component_type?: string;
  quantity_required: number;
  notes?: string;
}

interface SkuData {
  id?: string;
  sku: string;
  color: string;
  quantity: number;
  stock_level: number;
  price: number;
}

interface ProductModalProps {
  product: ProductWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (productData: Omit<Product, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> & {
    components?: ComponentData[];
    skus?: SkuData[];
  }) => void;
  onDelete?: (productId: string) => void;
  initialEditMode?: boolean;
}

export const ProductModal = ({ product, isOpen, onClose, onSave, onDelete, initialEditMode = false }: ProductModalProps) => {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    requires_assembly: false,
    image_url: '',
    print_file_id: null as string | null,
    file_name: null as string | null
  });
  const [components, setComponents] = useState<ComponentData[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [tempImageId, setTempImageId] = useState<string | null>(null);
  const [tempPrintFileId, setTempPrintFileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setIsEditing(initialEditMode);
        setFormData({
          name: product.name,
          description: product.description || '',
          requires_assembly: product.requires_assembly,
          image_url: product.image_url || '',
          is_active: product.is_active,
          print_file_id: product.print_file_id || null,
          file_name: product.file_name || null
        });
        setComponents(product.components || []);
        setSkus(product.skus || []);
      } else {
        // Clear ALL state for new product modal
        setIsEditing(true);
        setFormData({
          name: '',
          description: '',
          requires_assembly: false,
          image_url: '',
          print_file_id: null,
          file_name: null
        });
        setComponents([]);
        setSkus([]);
      }
      
      // Reset temp file states
      setTempImageId(null);
      setTempPrintFileId(null);
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  }, [product, isOpen, initialEditMode]);

  // Cleanup temp files when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Clean up temp files when modal closes without saving
      tempFileManager.clearAll();
    }
  }, [isOpen]);

  const handleClose = () => {
    // Always clean up temp files when closing
    tempFileManager.clearAll();
    setShowDeleteConfirm(false);
    onClose();
  };

  const handleDeleteProduct = () => {
    if (product && onDelete) {
      onDelete(product.id);
      handleClose();
    }
  };

  const handleImageChange = (tempFileId: string | null, previewUrl: string | null) => {
    setTempImageId(tempFileId);
    if (tempFileId) {
      // Clear the current image_url when we have a temp file
      setFormData(prev => ({ ...prev, image_url: '' }));
    }
  };

  const handlePrintFileChange = (tempFileId: string | null, fileName: string | null) => {
    setTempPrintFileId(tempFileId);
    if (tempFileId) {
      // Clear the current print_file_id when we have a temp file
      setFormData(prev => ({ ...prev, print_file_id: null, file_name: fileName }));
    }
  };

  const handleSave = async () => {
    if (!tenantId) {
      toast({
        title: "Error",
        description: "Tenant information not available",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      
      // Process temporary files first
      let finalImageUrl = formData.image_url;
      let finalPrintFileId = formData.print_file_id;
      let finalFileName = formData.file_name;
      
      // Upload temp image if exists
      if (tempImageId) {
        try {
          const imageUploadResults = await tempFileManager.processTempImages(tenantId);
          const uploadedImageUrl = imageUploadResults.get(tempImageId);
          if (uploadedImageUrl) {
            finalImageUrl = uploadedImageUrl;
          }
        } catch (error) {
          console.error('Failed to upload image:', error);
          toast({
            title: "Upload Failed",
            description: "Failed to upload image. Please try again.",
            variant: "destructive",
          });
          return;
        }
      }
      
      // Upload temp print file if exists
      if (tempPrintFileId) {
        try {
          const printFileUploadResults = await tempFileManager.processTempPrintFiles(tenantId);
          const uploadedPrintFileId = printFileUploadResults.get(tempPrintFileId);
          if (uploadedPrintFileId) {
            finalPrintFileId = uploadedPrintFileId;
            // Keep the file name from formData which was set during file selection
          }
        } catch (error) {
          console.error('Failed to upload print file:', error);
          toast({
            title: "Upload Failed",
            description: "Failed to upload print file. Please try again.",
            variant: "destructive",
          });
          return;
        }
      }

      // Prepare product data with final file URLs/IDs
      const productData = {
        ...formData,
        image_url: finalImageUrl,
        print_file_id: finalPrintFileId || null,
        file_name: finalFileName || null,
        components,
        // Always include SKUs data since they're now managed locally
        skus: skus.length > 0 ? skus : undefined
      };
      
      await onSave(productData);
      
      // Clear temp files after successful save
      tempFileManager.clearAll();
      
      // Only close modal if save was successful
      handleClose();
    } catch (error) {
      console.error('Error saving product:', error);
      
      // If product save failed, we should clean up any uploaded files
      // This is handled by the error boundary, but we can add specific cleanup here
      
      const errorMessage = error instanceof Error ? error.message : "Failed to save product";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      
      // Keep the modal open so user can retry
      // Don't clear temp files in case user wants to retry
    } finally {
      // ALWAYS reset saving state
      setSaving(false);
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader className="pr-12">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{product ? (isEditing ? 'Edit Product' : product.name) : 'Add New Product'}</DialogTitle>
              <DialogDescription>
                {product && !isEditing ? 'View product details and manage components' : 'Complete product information including assembly components.'}
              </DialogDescription>
            </div>
            {product && !isEditing && (
              <div className="flex gap-2">
                <Button onClick={() => setIsEditing(true)} variant="outline" size="sm">
                  Edit Product
                </Button>
                {onDelete && (
                  <Button 
                    onClick={() => setShowDeleteConfirm(true)} 
                    variant="outline" 
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogHeader>
        
        <ScrollArea className="max-h-[calc(85vh-180px)]">
          <div className="space-y-4 pr-4">
            {/* Product Name and Description */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name *</Label>
                {isEditing ? (
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter product name"
                  />
                ) : (
                  <p className="font-medium">{formData.name}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                {isEditing ? (
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter product description"
                    rows={2}
                  />
                ) : (
                  <p className="text-muted-foreground">{formData.description || 'No description provided'}</p>
                )}
              </div>
            </div>

            {/* Print File Upload/Display */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {isEditing ? (
                  <DeferredPrintFileUpload
                    currentPrintFileId={formData.print_file_id}
                    currentPrintFileName={product?.print_file?.name}
                    onPrintFileChange={handlePrintFileChange}
                    value={tempPrintFileId || formData.print_file_id}
                  />
                ) : (
                  <>
                    <Label htmlFor="print_file">Print File</Label>
                    <div className={`flex items-center gap-2 p-2 border rounded-md ${
                      formData.print_file_id ? 'border-green-200 bg-green-50' : 'border-gray-200'
                    }`}>
                      <File className={`h-4 w-4 ${
                        formData.print_file_id ? 'text-green-600' : 'text-muted-foreground'
                      }`} />
                      <span className="text-sm">
                        {formData.file_name || product?.print_file?.name || (formData.print_file_id ? 'File attached' : 'No file attached')}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <div></div>
            </div>

            {/* Toggle Controls */}
            <div className="flex items-center gap-8">
              <div className="flex items-center space-x-2">
                <Switch
                  id="requires_assembly"
                  checked={formData.requires_assembly}
                  onCheckedChange={(checked) => setFormData({ ...formData, requires_assembly: checked })}
                  disabled={!isEditing}
                />
                <Label htmlFor="requires_assembly">Assembly Required</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  disabled={!isEditing}
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
            </div>

            {/* Image Upload */}
            {isEditing && (
              <div className="space-y-2">
                <DeferredImageUpload
                  key={product?.id || 'new-product'}
                  currentImageUrl={formData.image_url}
                  onImageChange={handleImageChange}
                  label="Product Image"
                  value={tempImageId || formData.image_url}
                />
              </div>
            )}

            {/* SKUs Section */}
            <SkuManagement
              key={product?.id || 'new-product'}
              productId={product?.id}
              skus={product ? (product.skus || []) : skus}
              onSkusChange={setSkus}
              readOnly={!isEditing}
            />

            {/* Assembly Components */}
            <ProductAssemblyComponents
              productId={product?.id}
              components={components}
              onComponentsChange={setComponents}
              readOnly={!isEditing}
            />
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {product && !isEditing ? 'Close' : 'Cancel'}
          </Button>
          {(isEditing || !product) && (
            <Button onClick={handleSave} disabled={!formData.name.trim() || saving}>
              {saving ? 'Saving...' : (product ? 'Update' : 'Create')} Product
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{product?.name}"? This action cannot be undone and will permanently delete the product and all associated SKUs. Components are separate and will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteProduct}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
