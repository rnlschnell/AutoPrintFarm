
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryType } from "@/lib/data";
import { useMaterialInventory, MaterialInventoryItem } from "@/hooks/useMaterialInventory";
import { Plus, Search, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import MaterialFormModal from "@/components/MaterialFormModal";
import MaterialsTable from "@/components/MaterialsTable";

const defaultMaterialTypes: Record<InventoryType, string[]> = {
  'Filament': ['PLA', 'ABS', 'PETG', 'TPU', 'Resin', 'Wood Fill', 'Metal Fill'],
  'Packaging': ['Bubble Wrap', 'Cardboard Box', 'Tape', 'Labels', 'Foam Insert'],
  'Components': ['Keychain', 'Double-sided Tape', 'Screws', 'Magnets', 'O-rings', 'Washers'],
  'Printer Parts': ['Belt', 'Motor', 'Hotend', 'Extruder', 'Sensor', 'Fan']
};

const MaterialInventory = () => {
  const { materials: materialList, loading, addMaterial, updateMaterial, deleteMaterial } = useMaterialInventory();
  const [activeTab, setActiveTab] = useState<InventoryType>('Filament');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialInventoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<keyof MaterialInventoryItem | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Custom type management
  const [materialTypeOptions, setMaterialTypeOptions] = useState(defaultMaterialTypes);
  
  const [newMaterial, setNewMaterial] = useState({
    type: '',
    color: '',
    brand: '',
    diameter: '',
    costPerSpool: '',
    location: '',
    remaining: '',
    lowThreshold: '',
    image: '',
    reorderLink: '',
    isEditingLink: false
  });


  const { toast } = useToast();

  // Auto-calculate status based on remaining amount and threshold
  const calculateStatus = (remaining: number, threshold?: number): string => {
    const lowThreshold = threshold || 150;
    if (remaining === 0) return 'out_of_stock';
    if (remaining <= lowThreshold) return 'low';
    return 'in_stock';
  };

  // Filtered and sorted materials for current tab
  const filteredAndSortedMaterials = useMemo(() => {
    let filtered = materialList.filter(material => 
      material.category === activeTab &&
      (material.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      material.color.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (material.brand && material.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
      material.status.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    if (sortField) {
      filtered.sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];
        
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortDirection === 'asc' 
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }
        
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }
        
        return 0;
      });
    }

    return filtered;
  }, [materialList, searchQuery, sortField, sortDirection, activeTab]);

  const handleSort = (field: keyof MaterialInventoryItem) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleAddNewType = (newType: string) => {
    setMaterialTypeOptions({
      ...materialTypeOptions,
      [activeTab]: [...materialTypeOptions[activeTab], newType]
    });
    toast({
      title: "Type Added",
      description: `${newType} has been added to ${activeTab} types.`,
    });
  };

  const handleRemoveType = (typeToRemove: string) => {
    setMaterialTypeOptions({
      ...materialTypeOptions,
      [activeTab]: materialTypeOptions[activeTab].filter(type => type !== typeToRemove)
    });
    if (newMaterial.type === typeToRemove) {
      setNewMaterial({ ...newMaterial, type: '' });
    }
    toast({
      title: "Type Removed",
      description: `${typeToRemove} has been removed from ${activeTab} types.`,
    });
  };

  const handleAddMaterial = async () => {
    // Category-specific validation
    const isValidForCategory = () => {
      if (activeTab === 'Filament') {
        return newMaterial.type && newMaterial.color && newMaterial.remaining;
      } else {
        // For non-filament categories, color is optional
        return newMaterial.type && newMaterial.remaining;
      }
    };

    if (!isValidForCategory()) {
      toast({
        title: "Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const remainingAmount = parseInt(newMaterial.remaining);
    const threshold = newMaterial.lowThreshold ? parseInt(newMaterial.lowThreshold) : 150;
    
    try {
      await addMaterial(activeTab, {
        type: newMaterial.type,
        color: newMaterial.color,
        brand: newMaterial.brand || undefined,
        remaining: remainingAmount,
        diameter: newMaterial.diameter || undefined,
        location: newMaterial.location || undefined,
        cost_per_unit: newMaterial.costPerSpool ? parseFloat(newMaterial.costPerSpool) : undefined,
        low_threshold: threshold,
        reorder_link: newMaterial.reorderLink || undefined
      });

      setNewMaterial({
        type: '',
        color: '',
        brand: '',
        diameter: '',
        costPerSpool: '',
        location: '',
        remaining: '',
        lowThreshold: '',
        image: '',
        reorderLink: '',
        isEditingLink: false
      });
      setIsAddModalOpen(false);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleEditMaterial = async () => {
    // Category-specific validation
    const isValidForCategory = () => {
      if (activeTab === 'Filament') {
        return newMaterial.type && newMaterial.color && newMaterial.remaining;
      } else {
        // For non-filament categories, color is optional
        return newMaterial.type && newMaterial.remaining;
      }
    };

    if (!selectedMaterial || !isValidForCategory()) {
      toast({
        title: "Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const remainingAmount = parseInt(newMaterial.remaining);
    const threshold = newMaterial.lowThreshold ? parseInt(newMaterial.lowThreshold) : selectedMaterial.low_threshold || 150;

    try {
      await updateMaterial(selectedMaterial.id, selectedMaterial.category!, {
        type: newMaterial.type,
        color: newMaterial.color,
        brand: newMaterial.brand || undefined,
        remaining: remainingAmount,
        diameter: newMaterial.diameter || undefined,
        location: newMaterial.location || undefined,
        cost_per_unit: newMaterial.costPerSpool ? parseFloat(newMaterial.costPerSpool) : undefined,
        low_threshold: threshold,
        reorder_link: newMaterial.reorderLink || undefined,
        status: calculateStatus(remainingAmount, threshold)
      });

      setIsEditModalOpen(false);
      setSelectedMaterial(null);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleDeleteMaterial = async () => {
    if (!selectedMaterial) return;

    try {
      await deleteMaterial(selectedMaterial.id, selectedMaterial.category!);
      setDeleteDialogOpen(false);
      setSelectedMaterial(null);
    } catch (error) {
      // Error is handled by the hook
    }
  };


  const exportToCSV = () => {
    const headers = ['Category', 'Type', 'Color', 'Brand', 'Diameter', 'Cost Per Spool', 'Reorder Link', 'Remaining', 'Status', 'Low Threshold'];
    const csvContent = [
      headers.join(','),
      ...materialList.filter(m => m.category === activeTab).map(material => [
        material.category,
        material.type,
        material.color.split('|')[0] || material.color,
        material.brand || '',
        material.diameter || '',
        material.cost_per_unit || '',
        material.reorder_link || '',
        material.remaining,
        material.status,
        material.low_threshold || 150
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTab.toLowerCase()}-inventory.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `${activeTab} inventory exported to CSV file.`,
    });
  };

  const openAddModal = () => {
    // Reset the form data to blank state
    setNewMaterial({
      type: '',
      color: '',
      brand: '',
      diameter: '',
      costPerSpool: '',
      location: '',
      remaining: '',
      lowThreshold: '',
      image: '',
      reorderLink: '',
      isEditingLink: false
    });
    setIsAddModalOpen(true);
  };

  const openEditModal = (material: MaterialInventoryItem) => {
    setSelectedMaterial(material);
    setNewMaterial({
      type: material.type,
      color: material.color || '',
      brand: material.brand || '',
      diameter: material.diameter || '',
      costPerSpool: material.cost_per_unit?.toString() || '',
      location: material.location || '',
      remaining: material.remaining?.toString() || '',
      lowThreshold: (material.low_threshold || 150).toString(),
      image: '',
      reorderLink: material.reorder_link || '',
      isEditingLink: false
    });
    setIsEditModalOpen(true);
  };


  const openDeleteDialog = (material: MaterialInventoryItem) => {
    setSelectedMaterial(material);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Material Inventory</h1>
          <p className="text-muted-foreground">Track your filament, packaging, components, and printer parts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={openAddModal}>
            <Plus className="mr-2 h-4 w-4" />
            Add {activeTab}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => {
        const newTab = value as InventoryType;
        setActiveTab(newTab);
        // Reset form data when switching tabs to prevent cross-contamination
        setNewMaterial({
          type: '',
          color: '',
          brand: '',
          diameter: '',
          costPerSpool: '',
          location: '',
          remaining: '',
          lowThreshold: '',
          image: '',
          reorderLink: '',
          isEditingLink: false
        });
      }} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="Filament">Filament</TabsTrigger>
          <TabsTrigger value="Packaging">Packaging</TabsTrigger>
          <TabsTrigger value="Components">Components</TabsTrigger>
          <TabsTrigger value="Printer Parts">Printer Parts</TabsTrigger>
        </TabsList>

        {(['Filament', 'Packaging', 'Components', 'Printer Parts'] as InventoryType[]).map((category) => (
          <TabsContent key={category} value={category} className="mt-4 space-y-4">
            {/* Search and Controls */}
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Search ${category.toLowerCase()}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            
            <Card>
              <CardContent className="pt-6">
                <MaterialsTable
                  materials={filteredAndSortedMaterials}
                  category={category}
                  onSort={handleSort}
                  onEdit={openEditModal}
                  onDelete={openDeleteDialog}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <MaterialFormModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          // Reset form when modal is closed
          setNewMaterial({
            type: '',
            color: '',
            brand: '',
            diameter: '',
            costPerSpool: '',
            location: '',
            remaining: '',
            lowThreshold: '',
            image: '',
            reorderLink: '',
            isEditingLink: false
          });
        }}
        onSubmit={handleAddMaterial}
        activeTab={activeTab}
        materialData={newMaterial}
        onMaterialDataChange={setNewMaterial}
        materialTypeOptions={materialTypeOptions}
        onAddNewType={handleAddNewType}
        onRemoveType={handleRemoveType}
      />

      <MaterialFormModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          // Reset form when modal is closed
          setNewMaterial({
            type: '',
            color: '',
            brand: '',
            diameter: '',
            costPerSpool: '',
            location: '',
            remaining: '',
            lowThreshold: '',
            image: '',
            reorderLink: '',
            isEditingLink: false
          });
        }}
        onSubmit={handleEditMaterial}
        activeTab={activeTab}
        materialData={newMaterial}
        onMaterialDataChange={setNewMaterial}
        materialTypeOptions={materialTypeOptions}
        onAddNewType={handleAddNewType}
        onRemoveType={handleRemoveType}
        isEditMode={true}
      />


      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedMaterial?.type} ({selectedMaterial?.color?.split('|')[0] || selectedMaterial?.color}) from your inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMaterial} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MaterialInventory;
