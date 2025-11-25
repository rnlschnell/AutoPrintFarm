import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit2, Trash2, Tag, Sparkles } from 'lucide-react';
import { ProductSku, useProductsNew } from '@/hooks/useProductsNew';
import { useTenant } from '@/hooks/useTenant';
import { useColorPresetsContext } from '@/contexts/ColorPresetsContext';
import ColorSwatch from '@/components/ColorSwatch';
import { useToast } from '@/hooks/use-toast';
import FilamentSelector from '@/components/FilamentSelector';
import { api } from '@/lib/api-client';

interface SkuData {
  id?: string;
  sku: string;
  color: string;
  filament_type?: string;
  hex_code?: string;
  quantity: number;
  stock_level: number;
  price: number;
  low_stock_threshold?: number;
  is_active?: boolean;
  current_stock?: number;
  finishedGoodsStock?: number;  // Total from finished goods
}

interface SkuManagementProps {
  productId?: string;
  productName?: string;
  skus: ProductSku[];
  onSkusChange?: (skus: SkuData[]) => void; // Made optional since we now handle persistence directly
  readOnly?: boolean;
}

export const SkuManagement = ({ productId, productName = '', skus, onSkusChange, readOnly = false }: SkuManagementProps) => {
  const { tenant } = useTenant();
  const { colorPresets, loading: presetsLoading } = useColorPresetsContext();
  const { addSku, updateSku, deleteSku } = useProductsNew();
  const { toast } = useToast();
  const [localSkus, setLocalSkus] = useState<SkuData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [skuError, setSkuError] = useState<string>('');
  const [skuFormatIndex, setSkuFormatIndex] = useState(0);
  const [newSku, setNewSku] = useState<SkuData>({
    sku: '',
    color: '',
    quantity: 1,
    stock_level: 0,
    price: 0,
    low_stock_threshold: 0,
    is_active: true
  });

  // Simple effect to sync props with local state
  useEffect(() => {
    console.log('🔥 useEffect triggered - productId:', productId, 'skus.length:', skus.length);
    
    // Always sync with provided SKUs from props
    // Map SKUs to include current_stock for display
    const mappedSkus = skus.map(sku => ({
      id: sku.id,
      sku: sku.sku,
      color: sku.color,
      filament_type: sku.filament_type,
      hex_code: sku.hex_code,
      quantity: sku.quantity,
      stock_level: sku.stock_level,
      price: sku.price || 0,
      finishedGoodsStock: sku.finishedGoodsStock || 0,
      low_stock_threshold: sku.low_stock_threshold || 0,
    }));
    
    setLocalSkus(mappedSkus);
  }, [skus]);

  // Reset state when productId changes to prevent prepopulation bug
  useEffect(() => {
    // Only reset if productId is changing from one value to another, not when it's undefined
    if (productId === undefined) {
      // For new products, only reset if we haven't started adding SKUs yet
      setEditingIndex(null);
      setNewSku({
        sku: '',
        color: '',
        filament_type: '',
        hex_code: '',
        quantity: 1,
        stock_level: 0,
        price: 0,
        low_stock_threshold: 0
      });
      // Don't reset localSkus here - let it maintain any added SKUs for new products
    }
  }, [productId]);

  const handleAddSku = async () => {
    if (!newSku.sku || !newSku.color) return;

    console.log('Adding SKU, current localSkus:', localSkus);

    // Check for duplicate SKU name (case-insensitive) across ALL products in tenant
    try {
      const allTenantSkus = await api.get<any[]>('/api/v1/skus');
      if (allTenantSkus && allTenantSkus.length > 0) {
        const duplicateSku = allTenantSkus.find(existingSku =>
          existingSku.sku.toLowerCase() === newSku.sku.toLowerCase()
        );

        if (duplicateSku) {
          setSkuError('SKU name already in use. Please enter a unique SKU identifier');
          toast({
            title: "Error",
            description: "SKU name already in use. Please enter a unique SKU identifier",
            variant: "destructive",
          });
          return;
        }
      }
    } catch (error) {
      console.error('Error checking SKU uniqueness:', error);
      // Continue with local check as fallback
    }

    // Also check local SKUs for unsaved SKUs
    const localDuplicateSku = localSkus.find(existingSku =>
      existingSku.sku.toLowerCase() === newSku.sku.toLowerCase()
    );

    if (localDuplicateSku) {
      setSkuError('SKU name already in use. Please enter a unique SKU identifier');
      toast({
        title: "Error",
        description: "SKU name already in use. Please enter a unique SKU identifier",
        variant: "destructive",
      });
      return;
    }

    // Clear error if validation passes
    setSkuError('');

    // Always add to local state - don't save to database until product is saved
    const tempSku = {
      id: `temp-${Date.now()}`, // Temporary ID for UI purposes
      sku: newSku.sku,
      color: newSku.color,
      filament_type: newSku.filament_type || '',
      hex_code: newSku.hex_code || '',
      quantity: newSku.quantity,
      stock_level: newSku.stock_level,
      price: newSku.price,
      low_stock_threshold: newSku.low_stock_threshold || 0,
    };

    console.log('Adding temp SKU:', tempSku);
    const updatedSkus = [...localSkus, tempSku];
    console.log('Updated SKUs array:', updatedSkus);
    setLocalSkus(updatedSkus);

    // Call onSkusChange if provided to update parent component
    if (onSkusChange) {
      onSkusChange(updatedSkus);
    }

    // Reset the form
    setNewSku({
      sku: '',
      color: '',
      filament_type: '',
      hex_code: '',
      quantity: 1,
      stock_level: 0,
      price: 0,
      low_stock_threshold: 0
    });
  };

  const handleEditSku = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (index: number, updatedSku: SkuData) => {
    // Update local state - don't save to database until product is saved
    const updated = localSkus.map((sku, i) => 
      i === index ? { ...updatedSku } : sku
    );
    setLocalSkus(updated);
    
    // Call onSkusChange if provided to update parent component
    if (onSkusChange) {
      onSkusChange(updated);
    }
    
    setEditingIndex(null);
  };

  const handleDeleteSku = (index: number) => {
    // Remove from local state - don't save to database until product is saved
    const updated = localSkus.filter((_, i) => i !== index);
    setLocalSkus(updated);

    // Call onSkusChange if provided to update parent component
    if (onSkusChange) {
      onSkusChange(updated);
    }
  };

  const generateSku = () => {
    if (!productName || !newSku.color) return;

    // Extract abbreviations
    const words = productName.trim().split(/\s+/);
    const productInitials = words.map(w => w[0]).join('').toUpperCase().slice(0, 4);
    const productShort = productName.replace(/\s+/g, '').toUpperCase().slice(0, 5);
    const colorShort = newSku.color.toUpperCase().slice(0, 4);
    const filamentShort = newSku.filament_type?.slice(0, 3).toUpperCase() || 'MAT';
    const units = String(newSku.quantity).padStart(3, '0');

    // 4 format variations
    const formats = [
      `${productInitials}-${colorShort}-${units}`,           // BAGC-RED-003
      `${productShort}-${filamentShort}-${units}`,           // BAGCL-PLA-003
      `${productInitials}-${filamentShort}-${colorShort}`,   // BAGC-PLA-RED
      `${productShort.slice(0, 3)}-${colorShort.slice(0, 3)}-${units}` // BAG-RED-003
    ];

    const selectedFormat = formats[skuFormatIndex % formats.length];
    setNewSku({ ...newSku, sku: selectedFormat });
    setSkuFormatIndex(prev => prev + 1);
    if (skuError) setSkuError('');
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" />
          SKUs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing SKUs */}
        {localSkus.length > 0 ? (
          <div className="space-y-2">
            {localSkus.map((sku, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                {editingIndex === index && !readOnly ? (
                  <SkuEditForm
                    sku={sku}
                    allSkus={localSkus}
                    currentIndex={index}
                    onSave={(updatedSku) => handleSaveEdit(index, updatedSku)}
                    onCancel={() => setEditingIndex(null)}
                  />
                ) : (
                  <>
                     <div className="flex-1">
                       <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="font-medium">{sku.sku}</div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <ColorSwatch 
                                color={sku.hex_code || sku.color} 
                                filamentType={sku.filament_type}
                                size="sm" 
                              />
                              <span>{sku.color}{sku.filament_type ? ` (${sku.filament_type})` : ''}</span>
                              <span>•</span>
                              <span>Qty per Print: {sku.quantity}</span>
                              <span>•</span>
                              <span>${sku.price?.toFixed(2)}</span>
                            </div>
                          </div>
                           <div className="text-right mr-4">
                             <div className="font-medium">{sku.finishedGoodsStock || 0}</div>
                             <div className="text-sm text-muted-foreground">in stock</div>
                           </div>
                       </div>
                     </div>
                    {!readOnly && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditSku(index)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteSku(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            No SKUs added yet
          </div>
        )}

        {/* Add New SKU */}
        {!readOnly && (
          <div className="border-t pt-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="new-sku">SKU</Label>
                <div className="relative">
                  <Input
                    id="new-sku"
                    value={newSku.sku}
                    onChange={(e) => {
                      setNewSku({ ...newSku, sku: e.target.value });
                      // Clear error when user starts typing
                      if (skuError) setSkuError('');
                    }}
                    placeholder="e.g., PC-RED-001"
                    className={skuError ? 'border-red-500 pr-10' : 'pr-10'}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-8 w-8 rounded-sm"
                    style={{ backgroundColor: '#192A52' }}
                    onClick={generateSku}
                    disabled={!productName || !newSku.color}
                    title="Auto-generate SKU (click for variations)"
                  >
                    <Sparkles className="h-4 w-4 text-white" />
                  </Button>
                </div>
                {skuError && (
                  <p className="text-sm text-red-500 mt-1">{skuError}</p>
                )}
              </div>
               <div>
                 <Label htmlFor="new-filament">Filament</Label>
                 <FilamentSelector
                   value={newSku.color && newSku.filament_type ? `${newSku.color}|${newSku.filament_type}` : ''}
                   onValueChange={(value) => {
                     const [colorName, filamentType] = value.split('|');
                     const preset = colorPresets.find(p => p.color_name === colorName && p.filament_type === filamentType);
                     setNewSku({
                       ...newSku,
                       color: colorName,
                       filament_type: filamentType,
                       hex_code: preset?.hex_code || ''
                     });
                   }}
                   disabled={presetsLoading}
                   placeholder="Select filament"
                   width="w-full"
                 />
               </div>
               <div>
                 <Label htmlFor="new-quantity">Number of Units</Label>
                 <Input
                   id="new-quantity"
                   type="number"
                   value={newSku.quantity}
                   onChange={(e) => setNewSku({ ...newSku, quantity: parseInt(e.target.value) || 1 })}
                   min="1"
                 />
               </div>
               <div>
                 <Label htmlFor="new-price">Price ($)</Label>
                 <Input
                   id="new-price"
                   type="number"
                   step="0.01"
                   value={newSku.price}
                   onChange={(e) => setNewSku({ ...newSku, price: parseFloat(e.target.value) || 0 })}
                   min="0"
                 />
               </div>
               <div>
                 <Label htmlFor="new-low-stock-threshold">Low Stock Threshold</Label>
                 <Input
                   id="new-low-stock-threshold"
                   type="number"
                   value={newSku.low_stock_threshold}
                   onChange={(e) => setNewSku({ ...newSku, low_stock_threshold: parseInt(e.target.value) || 0 })}
                   min="0"
                 />
               </div>
            </div>
            <Button
              onClick={handleAddSku}
              disabled={!newSku.sku || !newSku.color}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add SKU
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SkuEditForm = ({
  sku,
  allSkus,
  currentIndex,
  onSave,
  onCancel
}: {
  sku: SkuData;
  allSkus: SkuData[];
  currentIndex: number;
  onSave: (sku: SkuData) => void;
  onCancel: () => void;
}) => {
  const [editSku, setEditSku] = useState<SkuData>(sku);
  const [skuError, setSkuError] = useState<string>('');
  const { colorPresets, loading: presetsLoading } = useColorPresetsContext();
  const { toast } = useToast();

  const handleSave = async () => {
    // Check for duplicate SKU name (case-insensitive) across ALL products in tenant, excluding current SKU
    try {
      const allTenantSkus = await api.get<any[]>('/api/v1/skus');
      if (allTenantSkus && allTenantSkus.length > 0) {
        const duplicateSku = allTenantSkus.find(existingSku =>
          existingSku.id !== sku.id && existingSku.sku.toLowerCase() === editSku.sku.toLowerCase()
        );

        if (duplicateSku) {
          setSkuError('SKU name already in use. Please enter a unique SKU identifier');
          toast({
            title: "Error",
            description: "SKU name already in use. Please enter a unique SKU identifier",
            variant: "destructive",
          });
          return;
        }
      }
    } catch (error) {
      console.error('Error checking SKU uniqueness:', error);
      // Continue with local check as fallback
    }

    // Also check local SKUs for unsaved SKUs, excluding current SKU
    const localDuplicateSku = allSkus.find((existingSku, index) =>
      index !== currentIndex && existingSku.sku.toLowerCase() === editSku.sku.toLowerCase()
    );

    if (localDuplicateSku) {
      setSkuError('SKU name already in use. Please enter a unique SKU identifier');
      toast({
        title: "Error",
        description: "SKU name already in use. Please enter a unique SKU identifier",
        variant: "destructive",
      });
      return;
    }

    // Clear error and save
    setSkuError('');
    onSave(editSku);
  };

  return (
    <div className="w-full">
      <div className="space-y-3 mb-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="edit-sku" className="text-xs font-medium text-muted-foreground">SKU</Label>
            <Input
              id="edit-sku"
              value={editSku.sku}
              onChange={(e) => {
                setEditSku({ ...editSku, sku: e.target.value });
                // Clear error when user starts typing
                if (skuError) setSkuError('');
              }}
              placeholder="Enter SKU"
              className={skuError ? 'border-red-500' : ''}
            />
            {skuError && (
              <p className="text-sm text-red-500 mt-1">{skuError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="edit-filament" className="text-xs font-medium text-muted-foreground">Filament</Label>
            <FilamentSelector
              value={editSku.color && editSku.filament_type ? `${editSku.color}|${editSku.filament_type}` : ''}
              onValueChange={(value) => {
                const [colorName, filamentType] = value.split('|');
                const preset = colorPresets.find(p => p.color_name === colorName && p.filament_type === filamentType);
                setEditSku({
                  ...editSku,
                  color: colorName,
                  filament_type: filamentType,
                  hex_code: preset?.hex_code || ''
                });
              }}
              disabled={presetsLoading}
              placeholder="Select filament"
              width="w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="edit-quantity" className="text-xs font-medium text-muted-foreground">Number of Units</Label>
            <Input
              id="edit-quantity"
              type="number"
              value={editSku.quantity}
              onChange={(e) => setEditSku({ ...editSku, quantity: parseInt(e.target.value) || 1 })}
              min="1"
            />
          </div>
          <div>
            <Label htmlFor="edit-price" className="text-xs font-medium text-muted-foreground">Price ($)</Label>
            <Input
              id="edit-price"
              type="number"
              step="0.01"
              value={editSku.price}
              onChange={(e) => setEditSku({ ...editSku, price: parseFloat(e.target.value) || 0 })}
              min="0"
            />
          </div>
          <div>
            <Label htmlFor="edit-low-stock-threshold" className="text-xs font-medium text-muted-foreground">Low Stock Threshold</Label>
            <Input
              id="edit-low-stock-threshold"
              type="number"
              value={editSku.low_stock_threshold || 0}
              onChange={(e) => setEditSku({ ...editSku, low_stock_threshold: parseInt(e.target.value) || 0 })}
              min="0"
            />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
};
