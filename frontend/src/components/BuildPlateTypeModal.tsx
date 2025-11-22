import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Edit, AlertTriangle, Layers } from "lucide-react";
import { useBuildPlateTypesContext } from "@/contexts/BuildPlateTypesContext";

interface BuildPlateType {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
}

interface BuildPlateTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BuildPlateTypeModal = ({ isOpen, onClose }: BuildPlateTypeModalProps) => {
  const { buildPlateTypes, loading, createBuildPlateType, updateBuildPlateType, deleteBuildPlateType, refetch } = useBuildPlateTypesContext();
  const [editingType, setEditingType] = useState<BuildPlateType | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: ""
  });
  const [deleteConfirmation, setDeleteConfirmation] = useState<BuildPlateType | null>(null);

  useEffect(() => {
    // No automatic refetch to prevent infinite loop
    // The hook already fetches data when tenant.id is available
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      return;
    }

    let success = false;
    if (editingType) {
      success = await updateBuildPlateType(
        editingType.id,
        formData.name,
        formData.description || undefined
      );
    } else {
      success = await createBuildPlateType(
        formData.name,
        formData.description || undefined
      );
    }

    if (success) {
      setFormData({ name: "", description: "" });
      setEditingType(null);
    }
  };

  const handleEdit = (type: BuildPlateType) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      description: type.description || ""
    });
  };

  const handleDelete = (type: BuildPlateType) => {
    setDeleteConfirmation(type);
  };

  const confirmDelete = async () => {
    if (deleteConfirmation) {
      await deleteBuildPlateType(deleteConfirmation.id);
      setDeleteConfirmation(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const resetForm = () => {
    setFormData({ name: "", description: "" });
    setEditingType(null);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Manage Build Plate Types
            </DialogTitle>
          </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <Label>Current Build Plate Types</Label>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-4">
              {buildPlateTypes.map((type) => (
                <div key={type.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{type.name}</span>
                    {type.description && (
                      <span className="text-xs text-muted-foreground">{type.description}</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(type)}
                      className="h-8 w-8 p-0"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(type)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {buildPlateTypes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No build plate types yet. Add one below.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <Label>{editingType ? "Edit Build Plate Type" : "Add New Build Plate Type"}</Label>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="build-plate-name">Name</Label>
                <Input
                  id="build-plate-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Textured PEI, Smooth PEI, Engineering Plate"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="build-plate-description">Description (Optional)</Label>
                <Textarea
                  id="build-plate-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g. Best for PLA and PETG adhesion"
                  rows={3}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {editingType && (
            <Button variant="outline" onClick={resetForm}>
              Cancel Edit
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={!formData.name.trim()}>
            {editingType ? (
              "Update Build Plate"
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add Build Plate
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
            Delete Build Plate Type
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete this build plate type?
          </p>

          {deleteConfirmation && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="font-medium text-sm">{deleteConfirmation.name}</div>
              {deleteConfirmation.description && (
                <div className="text-xs text-muted-foreground mt-1">{deleteConfirmation.description}</div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            This action cannot be undone. The build plate type will be permanently removed from your account.
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

export default BuildPlateTypeModal;
