import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit2, Trash2, Tag } from 'lucide-react';
import { ProductSku, useProductsNew } from '@/hooks/useProductsNew';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useColorPresets } from '@/hooks/useColorPresets';
import ColorSwatch from '@/components/ColorSwatch';
import { useToast } from '@/hooks/use-toast';

interface SkuData {
  id?: string;
  sku: string;
  color: string;
  filament_type?: string;
  hex_code?: string;
  quantity: number;
  stock_level: number;
  price: number;
  current_stock?: number;
}

interface SkuManagementProps {
  productId?: string;
  skus: ProductSku[];
  onSkusChange?: (skus: SkuData[]) => void; // Made optional since we now handle persistence directly
  readOnly?: boolean;
}

export const SkuManagement = ({ productId, skus, onSkusChange, readOnly = false }: SkuManagementProps) => {
  const { tenant } = useTenant();
  const { colorPresets, loading: presetsLoading } = useColorPresets();
  const { addSku, updateSku, deleteSku } = useProductsNew();
  const { toast } = useToast();
  const [localSkus, setLocalSkus] = useState<SkuData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newSku, setNewSku] = useState<SkuData>({
    sku: '',
    color: '',
    quantity: 1,
    stock_level: 0,
    price: 0
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
      current_stock: sku.stock_level || 0 // Use stock_level as current_stock
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
        price: 0
      });
      // Don't reset localSkus here - let it maintain any added SKUs for new products
    }
  }, [productId]);

  const handleAddSku = () => {
    if (!newSku.sku || !newSku.color) return;
    
    console.log('Adding SKU, current localSkus:', localSkus);
    
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
      current_stock: newSku.stock_level // Use stock_level as current_stock for local display
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
      price: 0
    });
  };

  const handleEditSku = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (index: number, updatedSku: SkuData) => {
    // Update local state - don't save to database until product is saved
    const updated = localSkus.map((sku, i) => 
      i === index ? { ...updatedSku, current_stock: updatedSku.stock_level } : sku
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
                             <div className="font-medium">{sku.stock_level || 0}</div>
                             <div className="text-sm text-muted-foreground">stock level</div>
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
                <Input
                  id="new-sku"
                  value={newSku.sku}
                  onChange={(e) => setNewSku({ ...newSku, sku: e.target.value })}
                  placeholder="e.g., PC-RED-001"
                />
              </div>
               <div>
                 <Label htmlFor="new-filament">Filament</Label>
                 <Select
                   value={newSku.color ? `${newSku.color}|${newSku.filament_type}` : ''}
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
                 >
                   <SelectTrigger>
                     <SelectValue placeholder="Select filament" />
                   </SelectTrigger>
                   <SelectContent>
                     {colorPresets.map((preset) => (
                       <SelectItem 
                         key={`${preset.color_name}-${preset.filament_type}`} 
                         value={`${preset.color_name}|${preset.filament_type}`}
                       >
                         <div className="flex items-center gap-2">
                           <ColorSwatch 
                             color={preset.hex_code} 
                             size="sm" 
                           />
                           <span>{preset.color_name} ({preset.filament_type})</span>
                         </div>
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
               <div>
                 <Label htmlFor="new-quantity">Quantity per Print</Label>
                 <Input
                   id="new-quantity"
                   type="number"
                   value={newSku.quantity}
                   onChange={(e) => setNewSku({ ...newSku, quantity: parseInt(e.target.value) || 1 })}
                   min="1"
                 />
               </div>
               <div>
                 <Label htmlFor="new-stock">Stock Level</Label>
                 <Input
                   id="new-stock"
                   type="number"
                   value={newSku.stock_level}
                   onChange={(e) => setNewSku({ ...newSku, stock_level: parseInt(e.target.value) || 0 })}
                   min="0"
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
  onSave, 
  onCancel 
}: { 
  sku: SkuData; 
  onSave: (sku: SkuData) => void; 
  onCancel: () => void;
}) => {
  const [editSku, setEditSku] = useState<SkuData>(sku);
  const { colorPresets, loading: presetsLoading } = useColorPresets();

  return (
    <div className="w-full">
      <div className="space-y-3 mb-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="edit-sku" className="text-xs font-medium text-muted-foreground">SKU</Label>
            <Input
              id="edit-sku"
              value={editSku.sku}
              onChange={(e) => setEditSku({ ...editSku, sku: e.target.value })}
              placeholder="Enter SKU"
            />
          </div>
          <div>
            <Label htmlFor="edit-filament" className="text-xs font-medium text-muted-foreground">Filament</Label>
            <Select
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
            >
              <SelectTrigger>
                <SelectValue placeholder="Select filament" />
              </SelectTrigger>
              <SelectContent>
                {colorPresets.map((preset) => (
                  <SelectItem 
                    key={`${preset.color_name}-${preset.filament_type}`} 
                    value={`${preset.color_name}|${preset.filament_type}`}
                  >
                    <div className="flex items-center gap-2">
                      <ColorSwatch 
                        color={preset.hex_code} 
                        size="sm" 
                      />
                      <span>{preset.color_name} ({preset.filament_type})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="edit-quantity" className="text-xs font-medium text-muted-foreground">Quantity per Print</Label>
            <Input
              id="edit-quantity"
              type="number"
              value={editSku.quantity}
              onChange={(e) => setEditSku({ ...editSku, quantity: parseInt(e.target.value) || 1 })}
              min="1"
            />
          </div>
          <div>
            <Label htmlFor="edit-stock" className="text-xs font-medium text-muted-foreground">Stock Level</Label>
            <Input
              id="edit-stock"
              type="number"
              value={editSku.stock_level}
              onChange={(e) => setEditSku({ ...editSku, stock_level: parseInt(e.target.value) || 0 })}
              min="0"
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
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(editSku)}>Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
};
