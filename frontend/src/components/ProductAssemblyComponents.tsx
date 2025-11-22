import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, Plus, Package, Check, Tag, Edit2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMaterialInventory } from '@/hooks/useMaterialInventory';

interface ComponentData {
  id?: string;
  component_name: string;
  accessory_id?: string;
  component_id?: string;
  quantity_required: number;
}

interface ProductAssemblyComponentsProps {
  productId?: string;
  components: ComponentData[];
  onComponentsChange: (components: ComponentData[]) => void;
  readOnly?: boolean;
  title?: string;
  icon?: 'package' | 'tag';
  emptyMessage?: string;
  showAddButton?: boolean;
}

export const ProductAssemblyComponents = ({ 
  productId, 
  components, 
  onComponentsChange,
  readOnly = false,
  title = "Assembly Components",
  icon = 'package',
  emptyMessage,
  showAddButton = true
}: ProductAssemblyComponentsProps) => {
  const [localComponents, setLocalComponents] = useState<ComponentData[]>(components);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newComponent, setNewComponent] = useState<ComponentData>({
    component_name: '',
    quantity_required: 1
  });
  const { toast } = useToast();
  const { materials, loading: materialsLoading } = useMaterialInventory();

  useEffect(() => {
    setLocalComponents(components);
  }, [components]);

  // Get components from accessories inventory
  const componentsInventory = materials.filter(material => material.category === 'Components');

  const openAddModal = () => {
    setNewComponent({
      component_name: '',
      quantity_required: 1
    });
    setShowAddModal(true);
  };

  const addComponent = () => {
    if (!newComponent.component_name.trim()) {
      toast({
        title: "Error",
        description: "Component name is required",
        variant: "destructive"
      });
      return;
    }

    const updated = [...localComponents, newComponent];
    setLocalComponents(updated);
    onComponentsChange(updated);
    setShowAddModal(false);
    setNewComponent({
      component_name: '',
      quantity_required: 1
    });
  };

  const updateComponent = (index: number, field: keyof ComponentData, value: string | number) => {
    const updated = localComponents.map((comp, i) => 
      i === index ? { ...comp, [field]: value } : comp
    );
    setLocalComponents(updated);
    onComponentsChange(updated);
  };

  const removeComponent = (index: number) => {
    const updated = localComponents.filter((_, i) => i !== index);
    setLocalComponents(updated);
    onComponentsChange(updated);
  };

  const handleEditComponent = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (index: number, updatedComponent: ComponentData) => {
    const updated = localComponents.map((comp, i) => 
      i === index ? updatedComponent : comp
    );
    setLocalComponents(updated);
    onComponentsChange(updated);
    setEditingIndex(null);
  };

  const getComponentInventoryInfo = (componentName: string) => {
    const inventoryItem = componentsInventory.find(item => item.type === componentName);
    return inventoryItem;
  };

  const IconComponent = icon === 'package' ? Package : Tag;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <IconComponent className="h-5 w-5" />
              {title}
            </CardTitle>
            {!readOnly && showAddButton && (
              <Button onClick={openAddModal} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add Component
              </Button>
            )}
          </div>
        </CardHeader>
      <CardContent className="space-y-4">
        {localComponents.length > 0 ? (
          <div className="space-y-2">
            {localComponents.map((component, index) => {
              const inventoryInfo = getComponentInventoryInfo(component.component_name);
              return (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  {editingIndex === index && !readOnly ? (
                    <ComponentEditForm
                      component={component}
                      componentsInventory={componentsInventory}
                      onSave={(updatedComponent) => handleSaveEdit(index, updatedComponent)}
                      onCancel={() => setEditingIndex(null)}
                    />
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="font-medium">{component.component_name}</div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>Qty Required: {component.quantity_required}</span>
                              {inventoryInfo && (
                                <>
                                  <span>•</span>
                                  <span>In Stock: {inventoryInfo.remaining_units || 0}</span>
                                  {inventoryInfo.cost_per_unit && (
                                    <>
                                      <span>•</span>
                                      <span>${inventoryInfo.cost_per_unit} each</span>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {inventoryInfo && (
                            <div className="text-right mr-4">
                              <div className="font-medium">{inventoryInfo.remaining_units || 0}</div>
                              <div className="text-sm text-muted-foreground">available</div>
                            </div>
                          )}
                        </div>
                      </div>
                      {!readOnly && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditComponent(index)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeComponent(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            No components added yet
          </div>
        )}

        {/* Add New Component */}
        {!readOnly && (
          <div className="border-t pt-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="new-component">Component</Label>
                <Select
                  value={newComponent.component_name}
                  onValueChange={(value) => {
                    const selectedItem = componentsInventory.find(item => item.type === value);
                    setNewComponent({
                      ...newComponent,
                      component_name: value,
                      accessory_id: selectedItem?.id
                    });
                  }}
                  disabled={materialsLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select component" />
                  </SelectTrigger>
                  <SelectContent>
                    {componentsInventory.map((item) => (
                      <SelectItem key={item.id} value={item.type}>
                        <div className="flex items-center justify-between w-full">
                          <span>{item.type}</span>
                          <span className="text-muted-foreground text-xs ml-2">
                            ({item.remaining_units || 0} available)
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="new-quantity">Quantity Required</Label>
                <Input
                  id="new-quantity"
                  type="number"
                  value={newComponent.quantity_required}
                  onChange={(e) => setNewComponent({ ...newComponent, quantity_required: parseInt(e.target.value) || 1 })}
                  min="1"
                />
              </div>
            </div>
            <Button
              onClick={addComponent}
              disabled={!newComponent.component_name || materialsLoading}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Component
            </Button>
          </div>
        )}
      </CardContent>
    </Card>

    </>
  );
};

const ComponentEditForm = ({ 
  component, 
  componentsInventory,
  onSave, 
  onCancel 
}: { 
  component: ComponentData; 
  componentsInventory: any[];
  onSave: (component: ComponentData) => void; 
  onCancel: () => void;
}) => {
  const [editComponent, setEditComponent] = useState<ComponentData>(component);

  return (
    <div className="w-full">
      <div className="space-y-3 mb-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="edit-component" className="text-xs font-medium text-muted-foreground">Component</Label>
            <Select
              value={editComponent.component_name}
              onValueChange={(value) => {
                const selectedItem = componentsInventory.find(item => item.type === value);
                setEditComponent({
                  ...editComponent,
                  component_name: value,
                  accessory_id: selectedItem?.id
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select component" />
              </SelectTrigger>
              <SelectContent>
                {componentsInventory.map((item) => (
                  <SelectItem key={item.id} value={item.type}>
                    <div className="flex items-center justify-between w-full">
                      <span>{item.type}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        ({item.remaining_units || 0} available)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-quantity" className="text-xs font-medium text-muted-foreground">Quantity Required</Label>
            <Input
              id="edit-quantity"
              type="number"
              value={editComponent.quantity_required}
              onChange={(e) => setEditComponent({ ...editComponent, quantity_required: parseInt(e.target.value) || 1 })}
              min="1"
            />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSave(editComponent)}
          disabled={!editComponent.component_name}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};