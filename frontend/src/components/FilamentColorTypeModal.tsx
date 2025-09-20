import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Edit, Palette, AlertTriangle } from "lucide-react";
import { HexColorPicker } from "react-colorful";
import { useColorPresetsContext } from "@/contexts/ColorPresetsContext";

interface ColorPreset {
  id: string;
  color_name: string;
  hex_code: string;
  filament_type: string;
  is_active: boolean;
}

interface FilamentColorTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FilamentColorTypeModal = ({ isOpen, onClose }: FilamentColorTypeModalProps) => {
  const { colorPresets, loading, createColorPreset, updateColorPreset, deleteColorPreset, refetch } = useColorPresetsContext();
  const [editingPreset, setEditingPreset] = useState<ColorPreset | null>(null);
  const [formData, setFormData] = useState({
    colorName: "",
    hexCode: "#ff0000",
    filamentType: ""
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<ColorPreset | null>(null);

  const filamentTypes = ['PLA', 'ABS', 'PETG', 'TPU', 'ASA', 'PC', 'Nylon', 'PVA', 'HIPS', 'Wood Fill', 'Metal Fill'];

  useEffect(() => {
    // Removed automatic refetch to prevent infinite loop
    // The hook already fetches data when tenant.id is available
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!formData.colorName.trim() || !formData.filamentType) {
      return;
    }

    let success = false;
    if (editingPreset) {
      success = await updateColorPreset(
        editingPreset.id,
        formData.colorName,
        formData.hexCode,
        formData.filamentType
      );
    } else {
      success = await createColorPreset(
        formData.colorName,
        formData.hexCode,
        formData.filamentType
      );
    }

    if (success) {
      setFormData({ colorName: "", hexCode: "#ff0000", filamentType: "" });
      setEditingPreset(null);
      setShowColorPicker(false);
    }
  };

  const handleEdit = (preset: ColorPreset) => {
    setEditingPreset(preset);
    setFormData({
      colorName: preset.color_name,
      hexCode: preset.hex_code,
      filamentType: preset.filament_type
    });
    setShowColorPicker(true);
  };

  const handleDelete = (preset: ColorPreset) => {
    setDeleteConfirmation(preset);
  };

  const confirmDelete = async () => {
    if (deleteConfirmation) {
      await deleteColorPreset(deleteConfirmation.id);
      setDeleteConfirmation(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const resetForm = () => {
    setFormData({ colorName: "", hexCode: "#ff0000", filamentType: "" });
    setEditingPreset(null);
    setShowColorPicker(false);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Filament Colors & Types</DialogTitle>
          </DialogHeader>
        
        <div className="space-y-6">
          <div className="space-y-4">
            <Label>Current Color Presets</Label>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-4">
              {colorPresets.map((preset) => (
                <div key={preset.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-6 h-6 rounded-full border border-border"
                      style={{ backgroundColor: preset.hex_code }}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{preset.color_name}</span>
                      <span className="text-xs text-muted-foreground">{preset.filament_type}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => handleEdit(preset)}
                      className="h-8 w-8 p-0"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => handleDelete(preset)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {colorPresets.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No color presets yet. Add one below.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>{editingPreset ? "Edit Color Preset" : "Add New Color Preset"}</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowColorPicker(!showColorPicker)}
              >
                <Palette className="h-4 w-4 mr-2" />
                {showColorPicker ? "Hide" : "Show"} Color Picker
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="filament-type">Filament Type</Label>
                <Select 
                  value={formData.filamentType} 
                  onValueChange={(value) => setFormData({ ...formData, filamentType: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {filamentTypes.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="color-name">Color Name</Label>
                <Input
                  id="color-name"
                  value={formData.colorName}
                  onChange={(e) => setFormData({ ...formData, colorName: e.target.value })}
                  placeholder="e.g. Metallic Silver"
                />
              </div>
            </div>
            
            {showColorPicker && (
              <div className="space-y-3">
                <HexColorPicker 
                  color={formData.hexCode} 
                  onChange={(color) => setFormData({ ...formData, hexCode: color })} 
                />
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full border-2 border-border"
                    style={{ backgroundColor: formData.hexCode }}
                  />
                  <Input
                    value={formData.hexCode}
                    onChange={(e) => setFormData({ ...formData, hexCode: e.target.value })}
                    className="font-mono"
                    placeholder="#000000"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {editingPreset && (
            <Button variant="outline" onClick={resetForm}>
              Cancel Edit
            </Button>
          )}
          <Button onClick={handleSubmit}>
            {editingPreset ? (
              "Update Color"
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add Color
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Delete Confirmation Dialog */}
    <Dialog open={!!deleteConfirmation} onOpenChange={() => setDeleteConfirmation(null)}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Color Preset
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete this color preset?
          </p>
          
          {deleteConfirmation && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div
                className="w-6 h-6 rounded-full border border-border"
                style={{ backgroundColor: deleteConfirmation.hex_code }}
              />
              <div>
                <div className="font-medium text-sm">{deleteConfirmation.color_name}</div>
                <div className="text-xs text-muted-foreground">{deleteConfirmation.filament_type}</div>
              </div>
            </div>
          )}
          
          <p className="text-xs text-muted-foreground">
            This action cannot be undone. The color preset will be permanently removed from your account.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancelDelete}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default FilamentColorTypeModal;