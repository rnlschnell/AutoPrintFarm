import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProductSku } from '@/hooks/useProductsNew';
import { useColorPresetsContext } from '@/contexts/ColorPresetsContext';
import ColorSwatch from '@/components/ColorSwatch';

interface SkuModalProps {
  sku: ProductSku | null;
  productId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (skuData: Omit<ProductSku, 'id' | 'created_at' | 'updated_at'>) => void;
}

export const SkuModal = ({ sku, productId, isOpen, onClose, onSave }: SkuModalProps) => {
  const { colorPresets, loading: presetsLoading } = useColorPresetsContext();
  const [formData, setFormData] = useState({
    product_id: productId,
    sku: '',
    color: '',
    filament_type: '',
    hex_code: '',
    quantity: 1,
    stock_level: 0,
    price: 0,
  });

  useEffect(() => {
    if (sku) {
      setFormData({
        product_id: sku.product_id,
        sku: sku.sku,
        color: sku.color,
        filament_type: sku.filament_type || '',
        hex_code: sku.hex_code || '',
        quantity: sku.quantity,
        stock_level: sku.stock_level,
        price: sku.price || 0,
        is_active: sku.is_active,
      });
    } else {
      setFormData({
        product_id: productId,
        sku: '',
        color: '',
        filament_type: '',
        hex_code: '',
        quantity: 1,
        stock_level: 0,
        price: 0,
      });
    }
  }, [sku, productId, isOpen]);

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sku ? 'Edit SKU' : 'Add New SKU'}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="sku">SKU</Label>
            <Input
              id="sku"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              placeholder="Enter SKU"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="filament">Filament</Label>
            <Select
              value={formData.color && formData.filament_type ? `${formData.color}|${formData.filament_type}` : ''}
              onValueChange={(value) => {
                const [colorName, filamentType] = value.split('|');
                const preset = colorPresets.find(p => p.color_name === colorName && p.filament_type === filamentType);
                setFormData({ 
                  ...formData, 
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity per Print</Label>
              <Input
                id="quantity"
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                min="1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock_level">Stock Level</Label>
              <Input
                id="stock_level"
                type="number"
                value={formData.stock_level}
                onChange={(e) => setFormData({ ...formData, stock_level: parseInt(e.target.value) || 0 })}
                min="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Price ($)</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
              min="0"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {sku ? 'Update' : 'Create'} SKU
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};