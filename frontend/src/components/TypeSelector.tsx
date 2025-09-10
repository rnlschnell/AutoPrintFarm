
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { InventoryType } from "@/lib/data";

interface TypeSelectorProps {
  activeTab: InventoryType;
  selectedType: string;
  onTypeChange: (type: string) => void;
  materialTypeOptions: Record<InventoryType, string[]>;
  onAddNewType: (type: string) => void;
  onRemoveType: (type: string) => void;
}

const TypeSelector = ({
  activeTab,
  selectedType,
  onTypeChange,
  materialTypeOptions,
  onAddNewType,
  onRemoveType
}: TypeSelectorProps) => {
  const [newTypeInput, setNewTypeInput] = useState("");
  const [showNewTypeInput, setShowNewTypeInput] = useState(false);

  const handleAddNewType = () => {
    if (newTypeInput.trim()) {
      onAddNewType(newTypeInput.trim());
      onTypeChange(newTypeInput.trim());
      setNewTypeInput("");
      setShowNewTypeInput(false);
    }
  };

  return (
    <>
      <Select value={selectedType} onValueChange={onTypeChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${activeTab.toLowerCase()} type`} />
        </SelectTrigger>
        <SelectContent>
          {materialTypeOptions[activeTab].map(option => (
            <SelectItem key={option} value={option}>
              <div className="flex items-center justify-between w-full">
                <span className="flex-1">{option}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 ml-2 hover:bg-red-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveType(option);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showNewTypeInput ? (
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Enter new type"
            value={newTypeInput}
            onChange={(e) => setNewTypeInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddNewType()}
          />
          <Button size="sm" onClick={handleAddNewType}>Add</Button>
          <Button size="sm" variant="outline" onClick={() => setShowNewTypeInput(false)}>Cancel</Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setShowNewTypeInput(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add New Type
        </Button>
      )}
    </>
  );
};

export default TypeSelector;
