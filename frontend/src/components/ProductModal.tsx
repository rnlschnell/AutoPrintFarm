
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
import { ProductPrintFilesManager, PrintFileEntry } from './ProductPrintFilesManager';
import { FileDetailsModal } from './FileDetailsModal';
import { PrinterPriorityDialog } from './PrinterPriorityDialog';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { tempFileManager } from '@/lib/tempFileManager';
import { generateUUID } from '@/lib/uuid';
import { File, Trash2, Info, Settings } from 'lucide-react';
import { useWikis } from '@/hooks/useWikis';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ComponentData {
  id?: string;
  component_name: string;
  accessory_id?: string;
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
  low_stock_threshold?: number;
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
  const { wikis, fetchWikis } = useWikis();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    requires_assembly: false,
    requires_post_processing: false,
    use_printer_priority: false,
    printer_priority: [] as string[],
    image_url: '',
    print_file_id: null as string | null,
    file_name: null as string | null,
    wiki_id: null as string | null
  });
  const [components, setComponents] = useState<ComponentData[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [tempImageId, setTempImageId] = useState<string | null>(null);
  const [printFiles, setPrintFiles] = useState<PrintFileEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFileDetails, setShowFileDetails] = useState(false);
  const [selectedFileIdForDetails, setSelectedFileIdForDetails] = useState<string | null>(null);
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Fetch wikis for the selector
      fetchWikis();

      // ALWAYS reset printFiles state first to prevent leakage between modals
      setPrintFiles([]);

      if (product) {
        setIsEditing(initialEditMode);

        // Parse printer_priority from JSON string if it exists
        let printerPriority: string[] = [];
        let usePrinterPriority = false;

        if (product.printer_priority) {
          try {
            printerPriority = JSON.parse(product.printer_priority);
            usePrinterPriority = true;
          } catch (e) {
            console.error('Failed to parse printer_priority:', e);
          }
        }

        setFormData({
          name: product.name,
          description: product.description || '',
          requires_assembly: product.requires_assembly,
          requires_post_processing: product.requires_post_processing || false,
          use_printer_priority: usePrinterPriority,
          printer_priority: printerPriority,
          image_url: product.image_url || '',
          print_file_id: product.print_file_id || null,
          file_name: product.file_name || null,
          wiki_id: (product as any).wiki_id || null
        });
        setComponents(product.components || []);
        setSkus([...product.skus] || []);

        // Load existing print files from product
        if (product.print_files && product.print_files.length > 0) {
          console.log(`[ProductModal] Loading ${product.print_files.length} print files for product:`, product.name);
          const existingFiles: PrintFileEntry[] = product.print_files.map(pf => ({
            id: pf.id,
            printerModelCode: pf.printer_model_id || null,
            fileName: pf.file_name || pf.name,
            isTemp: false
          }));
          setPrintFiles(existingFiles);
        } else if (product.print_file_id && product.file_name) {
          // Fallback: legacy single file support for backward compatibility
          console.log(`[ProductModal] Loading legacy print file for product:`, product.name, product.file_name);
          const legacyFile: PrintFileEntry = {
            id: product.print_file_id,
            printerModelCode: null, // Legacy files don't have model info
            fileName: product.file_name,
            isTemp: false
          };
          setPrintFiles([legacyFile]);
        } else {
          console.log(`[ProductModal] No print files found for product:`, product.name);
        }
      } else {
        // Clear ALL state for new product modal
        console.log(`[ProductModal] Opening new product modal - all state cleared`);
        setIsEditing(true);
        setFormData({
          name: '',
          description: '',
          requires_assembly: false,
          requires_post_processing: false,
          use_printer_priority: false,
          printer_priority: [],
          image_url: '',
          print_file_id: null,
          file_name: null
        });
        setComponents([]);
        setSkus([]);
        // printFiles already reset above
      }

      // Reset temp file states
      setTempImageId(null);
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  }, [product, isOpen, initialEditMode]);

  // Cleanup temp files when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Clean up temp files when modal closes without saving
      tempFileManager.clear();
    }
  }, [isOpen]);

  const handleClose = () => {
    // Always clean up temp files when closing
    tempFileManager.clear();
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

  const handlePrintFilesChange = (files: PrintFileEntry[]) => {
    setPrintFiles(files);
  };

  const handleViewFileDetails = (fileId: string) => {
    setSelectedFileIdForDetails(fileId);
    setShowFileDetails(true);
  };

  const handlePrioritySave = (priority: string[]) => {
    setFormData(prev => ({
      ...prev,
      printer_priority: priority
    }));
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

      // Generate product ID upfront for new products (needed for image upload)
      // For existing products, use the existing ID
      const productId = product?.id || generateUUID();

      // Process temporary files first
      let finalImageUrl = formData.image_url;
      let finalPrintFileId = formData.print_file_id;
      let finalFileName = formData.file_name;

      // Upload temp image if exists
      if (tempImageId) {
        try {
          const imageUploadResults = await tempFileManager.processTempImages(tenantId, productId);
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
      
      // Upload temp print files if any exist
      let uploadedPrintFileIds: string[] = [];
      if (printFiles.length > 0) {
        try {
          // Upload all temp print files
          const printFileUploadResults = await tempFileManager.processTempPrintFiles(tenantId);

          // Collect ALL print file IDs (existing + newly uploaded)
          // This ensures existing files remain linked when editing a product
          uploadedPrintFileIds = [
            ...printFiles.filter(f => !f.isTemp).map(f => f.id), // Existing files
            ...Array.from(printFileUploadResults.values())       // New uploads
          ];

          // For backward compatibility, set the first uploaded file as the primary print_file_id
          const firstTempFile = printFiles.find(f => f.isTemp);
          if (firstTempFile) {
            const uploadedId = printFileUploadResults.get(firstTempFile.id);
            if (uploadedId) {
              finalPrintFileId = uploadedId;
              finalFileName = firstTempFile.fileName;
            }
          }

          console.log(`Uploaded ${printFileUploadResults.size} print files:`, uploadedPrintFileIds);
        } catch (error) {
          console.error('Failed to upload print files:', error);
          toast({
            title: "Upload Failed",
            description: "Failed to upload print files. Please try again.",
            variant: "destructive",
          });
          return;
        }
      } else if (printFiles.length === 0 && !product) {
        // New product with no files - show error
        toast({
          title: "No Print Files",
          description: "At least one print file is required for a new product.",
          variant: "destructive",
        });
        return;
      }

      // Prepare product data with final file URLs/IDs
      const productData = {
        ...formData,
        // Include the generated/existing product ID (for new products, use pre-generated ID)
        ...(product ? {} : { id: productId }),
        image_url: finalImageUrl,
        print_file_id: finalPrintFileId || null,
        file_name: finalFileName || null,
        // Convert printer_priority to JSON string for storage, or null if disabled
        printer_priority: formData.use_printer_priority && formData.printer_priority.length > 0
          ? JSON.stringify(formData.printer_priority)
          : null,
        components,
        // Always include SKUs data since they're now managed locally
        skus: skus.length > 0 ? skus : undefined,
        // Include ALL uploaded print file IDs for linking to product
        uploaded_print_file_ids: uploadedPrintFileIds.length > 0 ? uploadedPrintFileIds : undefined
      };

      await onSave(productData);

      // Clear temp files after successful save
      tempFileManager.clear();

      // Only close modal if save was successful
      handleClose();
    } catch (error: any) {
      console.error('Error saving product:', error);

      // If product save failed, we should clean up any uploaded files
      // This is handled by the error boundary, but we can add specific cleanup here

      // Extract the actual error message from the error object
      const errorMessage = error?.message || "Failed to save product";

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

            {/* Print Files Manager - Multi-Model Support */}
            <ProductPrintFilesManager
              key={product?.id || 'new-product'}
              productId={product?.id}
              existingFiles={printFiles}
              onFilesChange={handlePrintFilesChange}
              onViewDetails={handleViewFileDetails}
              readOnly={!isEditing}
            />

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
                  id="requires_post_processing"
                  checked={formData.requires_post_processing}
                  onCheckedChange={(checked) => setFormData({ ...formData, requires_post_processing: checked })}
                  disabled={!isEditing}
                />
                <Label htmlFor="requires_post_processing">Post-processing Required</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="use_printer_priority"
                  checked={formData.use_printer_priority}
                  onCheckedChange={(checked) => setFormData({ ...formData, use_printer_priority: checked })}
                  disabled={!isEditing}
                />
                <Label htmlFor="use_printer_priority">Printer Priority Routing</Label>
                {formData.use_printer_priority && isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPriorityDialog(true)}
                    className="ml-2"
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Configure
                  </Button>
                )}
              </div>
            </div>

            {/* Wiki Selector */}
            <div className="space-y-2">
              <Label htmlFor="wiki_id">Assembly Instructions Wiki (Optional)</Label>
              <Select
                value={formData.wiki_id || 'none'}
                onValueChange={(value) => setFormData({ ...formData, wiki_id: value === 'none' ? null : value })}
                disabled={!isEditing}
              >
                <SelectTrigger id="wiki_id">
                  <SelectValue placeholder="Select a wiki..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No wiki</SelectItem>
                  {wikis.map((wiki) => (
                    <SelectItem key={wiki.id} value={wiki.id}>
                      {wiki.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.wiki_id && (
                <p className="text-sm text-muted-foreground">
                  Wiki will auto-open when assembly tasks are started
                </p>
              )}
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
              productName={formData.name}
              skus={skus}
              onSkusChange={setSkus}
              readOnly={!isEditing}
            />

            {/* Assembly Components */}
            {formData.requires_assembly && (
              <ProductAssemblyComponents
                productId={product?.id}
                components={components}
                onComponentsChange={setComponents}
                readOnly={!isEditing}
              />
            )}
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

      {/* File Details Modal */}
      <FileDetailsModal
        printFileId={selectedFileIdForDetails}
        isOpen={showFileDetails}
        onClose={() => setShowFileDetails(false)}
      />

      {/* Printer Priority Dialog */}
      <PrinterPriorityDialog
        isOpen={showPriorityDialog}
        onClose={() => setShowPriorityDialog(false)}
        currentPriority={formData.printer_priority}
        onSave={handlePrioritySave}
      />
    </Dialog>
  );
};
