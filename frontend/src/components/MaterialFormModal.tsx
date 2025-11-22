
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InventoryType } from "@/lib/data";
import { useColorPresetsContext } from "@/contexts/ColorPresetsContext";
import { useToast } from "@/hooks/use-toast";
import FilamentColorTypeModal from "@/components/FilamentColorTypeModal";
import { Plus } from "lucide-react";

interface MaterialFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (materialData: any) => void;
  activeTab: InventoryType;
  materialData: {
    type: string;
    color: string;
    brand: string;
    diameter: string;
    costPerSpool: string;
    location: string;
    remaining: string;
    lowThreshold: string;
    image: string;
    reorderLink?: string;
    isEditingLink?: boolean;
  };
  onMaterialDataChange: (data: any) => void;
  materialTypeOptions: Record<InventoryType, string[]>;
  onAddNewType: (type: string) => void;
  onRemoveType: (type: string) => void;
  isEditMode?: boolean;
}

const MaterialFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  activeTab,
  materialData,
  onMaterialDataChange,
  materialTypeOptions,
  onAddNewType,
  onRemoveType,
  isEditMode = false
}: MaterialFormModalProps) => {
  const { colorPresets } = useColorPresetsContext();
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [availableColors, setAvailableColors] = useState<any[]>([]);
  const [showAddColorModal, setShowAddColorModal] = useState(false);
  const [preSelectedType, setPreSelectedType] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    if (activeTab === 'Filament' && colorPresets.length > 0) {
      // Extract unique types from color presets
      const types = [...new Set(colorPresets.map(preset => preset.filament_type))];
      setAvailableTypes(types);
    }
  }, [activeTab, colorPresets]);

  useEffect(() => {
    // Update available colors when type changes
    if (materialData.type && activeTab === 'Filament') {
      const colorsForType = colorPresets.filter(preset => preset.filament_type === materialData.type);
      setAvailableColors(colorsForType);
      
      // Clear color selection if current color is not available for selected type
      if (materialData.color && !colorsForType.find(c => c.color_name === materialData.color)) {
        onMaterialDataChange({ ...materialData, color: '' });
      }
    } else {
      setAvailableColors([]);
    }
  }, [materialData.type, colorPresets, activeTab, materialData.color, onMaterialDataChange]);
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Material' : `Add New ${activeTab}`}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Update material information.' : `Add a new ${activeTab.toLowerCase()} to your inventory.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {activeTab === 'Filament' ? (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">Type *</Label>
                <div className="col-span-3">
                  <Select
                    value={materialData.type}
                    onValueChange={(value) => {
                      // Handle "Add New" option
                      if (value === '__ADD_NEW_TYPE__') {
                        setPreSelectedType('');
                        setShowAddColorModal(true);
                        return;
                      }
                      onMaterialDataChange({ ...materialData, type: value, color: '' });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select filament type" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTypes.map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                      <SelectItem value="__ADD_NEW_TYPE__">
                        <div className="flex items-center gap-2 text-primary">
                          <Plus className="h-4 w-4" />
                          <span>Add New Type</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="color" className="text-right">Color *</Label>
                <div className="col-span-3">
                  <Select
                    value={materialData.color}
                    onValueChange={(value) => {
                      // Handle "Add New" option
                      if (value === '__ADD_NEW_COLOR__') {
                        setPreSelectedType(materialData.type);
                        setShowAddColorModal(true);
                        return;
                      }
                      onMaterialDataChange({ ...materialData, color: value });
                    }}
                    disabled={!materialData.type}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={materialData.type ? "Select color" : "Select type first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableColors.map(color => (
                        <SelectItem key={color.id} value={color.color_name}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded-full border border-border"
                              style={{ backgroundColor: color.hex_code }}
                            />
                            {color.color_name}
                          </div>
                        </SelectItem>
                      ))}
                      {materialData.type && (
                        <SelectItem value="__ADD_NEW_COLOR__">
                          <div className="flex items-center gap-2 text-primary">
                            <Plus className="h-4 w-4" />
                            <span>Add New Color</span>
                          </div>
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">Type *</Label>
                <div className="col-span-3">
                  <Input
                    id="type"
                    value={materialData.type}
                    onChange={(e) => onMaterialDataChange({ ...materialData, type: e.target.value })}
                    placeholder="Enter type"
                  />
                </div>
              </div>
        </>
      )}
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="brand" className="text-right">Brand</Label>
        <Input
          id="brand"
          value={materialData.brand}
          onChange={(e) => onMaterialDataChange({ ...materialData, brand: e.target.value })}
          className="col-span-3"
          placeholder="e.g. Hatchbox, eSUN"
        />
      </div>
      
      {activeTab === 'Filament' && (
        <>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="location" className="text-right">Storage Location</Label>
            <Input
              id="location"
              value={materialData.location}
              onChange={(e) => onMaterialDataChange({ ...materialData, location: e.target.value })}
              className="col-span-3"
              placeholder="e.g. Shelf A, Bin 3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="costPerSpool" className="text-right">Cost Per Spool ($)</Label>
            <Input
              id="costPerSpool"
              type="number"
              step="0.01"
              value={materialData.costPerSpool}
              onChange={(e) => onMaterialDataChange({ ...materialData, costPerSpool: e.target.value })}
              className="col-span-3"
              placeholder="25.99"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="remaining" className="text-right">Current Amount (g) *</Label>
            <Input
              id="remaining"
              type="number"
              value={materialData.remaining}
              onChange={(e) => onMaterialDataChange({ ...materialData, remaining: e.target.value })}
              className="col-span-3"
              placeholder="1000"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="lowThreshold" className="text-right">Low Threshold (g)</Label>
            <Input
              id="lowThreshold"
              type="number"
              value={materialData.lowThreshold}
              onChange={(e) => onMaterialDataChange({ ...materialData, lowThreshold: e.target.value })}
              className="col-span-3"
              placeholder="150"
            />
          </div>
        </>
      )}
      
      {activeTab !== 'Filament' && (
        <>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="location" className="text-right">Storage Location</Label>
            <Input
              id="location"
              value={materialData.location}
              onChange={(e) => onMaterialDataChange({ ...materialData, location: e.target.value })}
              className="col-span-3"
              placeholder="e.g. Shelf A, Bin 3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="costPerUnit" className="text-right">Cost Per Unit ($)</Label>
            <Input
              id="costPerUnit"
              type="number"
              step="0.01"
              value={materialData.costPerSpool}
              onChange={(e) => onMaterialDataChange({ ...materialData, costPerSpool: e.target.value })}
              className="col-span-3"
              placeholder="25.99"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="remaining" className="text-right">Current Stock (units) *</Label>
            <Input
              id="remaining"
              type="number"
              value={materialData.remaining}
              onChange={(e) => onMaterialDataChange({ ...materialData, remaining: e.target.value })}
              className="col-span-3"
              placeholder="100"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="lowThreshold" className="text-right">Low Threshold (units)</Label>
            <Input
              id="lowThreshold"
              type="number"
              value={materialData.lowThreshold}
              onChange={(e) => onMaterialDataChange({ ...materialData, lowThreshold: e.target.value })}
              className="col-span-3"
              placeholder="10"
            />
          </div>
        </>
      )}
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="reorderLink" className="text-right">Reorder Link</Label>
        <div className="col-span-3">
          {materialData.reorderLink && !materialData.isEditingLink && isEditMode ? (
            <div className="flex gap-2">
              <Button 
                type="button"
                onClick={() => window.open(materialData.reorderLink, '_blank')}
                className="flex-1"
              >
                Reorder
              </Button>
              <Button 
                type="button"
                variant="outline"
                onClick={() => onMaterialDataChange({ ...materialData, isEditingLink: true })}
              >
                Edit Link
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="reorderLink"
                value={materialData.reorderLink || ''}
                onChange={(e) => onMaterialDataChange({ ...materialData, reorderLink: e.target.value })}
                placeholder="https://example.com/product"
                className="flex-1"
              />
              {materialData.isEditingLink && isEditMode && (
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => onMaterialDataChange({ ...materialData, isEditingLink: false })}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
        </div>
        <DialogFooter>
          <Button type="submit" onClick={onSubmit}>
            {isEditMode ? 'Update Material' : `Add ${activeTab}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <FilamentColorTypeModal
        isOpen={showAddColorModal}
        onClose={() => setShowAddColorModal(false)}
        quickAddMode={true}
        onColorAdded={(preset) => {
          // Auto-populate BOTH type and color from the newly created preset
          onMaterialDataChange({
            ...materialData,
            type: preset.filament_type,
            color: preset.color_name
          });
        }}
      />
    </Dialog>
  );
};

export default MaterialFormModal;
