import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ColorSwatch from "@/components/ColorSwatch";
import { useColorPresetsContext } from "@/contexts/ColorPresetsContext";
import FilamentColorTypeModal from "@/components/FilamentColorTypeModal";

interface FilamentSelectorProps {
  value: string; // Format: "color|filament_type" or empty string
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  width?: string; // Tailwind width class, defaults to w-56
  triggerClassName?: string; // Additional classes for the trigger button
}

const FilamentSelector = ({
  value,
  onValueChange,
  disabled = false,
  placeholder = "Select filament",
  width = "w-56",
  triggerClassName = "",
}: FilamentSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddColorModal, setShowAddColorModal] = useState(false);
  const { colorPresets, loading } = useColorPresetsContext();

  // Parse the current value to display
  const getCurrentPreset = () => {
    if (!value) return null;
    const [colorName, filamentType] = value.split('|');
    return colorPresets.find(
      p => p.color_name === colorName && p.filament_type === filamentType
    );
  };

  const currentPreset = getCurrentPreset();

  const handleSelect = (colorName: string, filamentType: string) => {
    onValueChange(`${colorName}|${filamentType}`);
    setIsOpen(false);
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled || loading}
            className={`justify-start ${width} ${triggerClassName}`}
          >
            {currentPreset ? (
              <div className="flex items-center gap-2 w-full">
                <ColorSwatch
                  color={currentPreset.hex_code}
                  size="sm"
                />
                <span className="truncate">
                  {currentPreset.color_name} ({currentPreset.filament_type})
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="bg-background border shadow-lg z-50 max-h-[320px] overflow-hidden"
          style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
        >
          <div className="overflow-y-auto max-h-[250px]">
            {colorPresets.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                No color presets available
              </div>
            ) : (
              colorPresets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => handleSelect(preset.color_name, preset.filament_type)}
                  className="flex items-center gap-3 cursor-pointer hover:bg-muted"
                >
                  <ColorSwatch
                    color={preset.hex_code}
                    size="sm"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{preset.color_name}</span>
                    <span className="text-xs text-muted-foreground">{preset.filament_type}</span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </div>
          {colorPresets.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onClick={() => {
              setIsOpen(false);
              setShowAddColorModal(true);
            }}
            className="flex items-center gap-3 cursor-pointer hover:bg-muted text-primary"
          >
            <Plus className="h-4 w-4" />
            <span className="font-medium">Add New</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FilamentColorTypeModal
        isOpen={showAddColorModal}
        onClose={() => setShowAddColorModal(false)}
        quickAddMode={true}
        onColorAdded={(preset) => {
          // Auto-select the newly created preset
          handleSelect(preset.color_name, preset.filament_type);
        }}
      />
    </>
  );
};

export default FilamentSelector;
