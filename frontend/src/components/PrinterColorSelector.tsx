import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { type Printer } from "@/hooks/usePrinters";
import { useToast } from "@/hooks/use-toast";
import FilamentColorTypeModal from "@/components/FilamentColorTypeModal";

interface PrinterColorSelectorProps {
  printer: Printer;
  updatePrinter: (id: string, updates: Partial<Printer>) => Promise<Printer>;
}

const PrinterColorSelector = ({ printer, updatePrinter }: PrinterColorSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddColorModal, setShowAddColorModal] = useState(false);
  const { colorPresets, loading } = useColorPresetsContext();
  const { toast } = useToast();

  const handleColorSelect = async (colorName: string, hexCode: string, filamentType: string) => {
    try {
      await updatePrinter(printer.id, {
        currentColor: colorName,
        currentColorHex: hexCode,
        currentFilamentType: filamentType,
      });

      setIsOpen(false);
    } catch (error) {
      console.error('Error updating printer color:', error);
      toast({
        title: "Error",
        description: "Failed to update printer color.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-50">
        <Pencil className="h-2.5 w-2.5" />
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-black/10 transition-colors"
          >
            <Pencil className="h-2.5 w-2.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-background border shadow-lg z-50 max-h-[320px] overflow-hidden">
          <div className="overflow-y-auto max-h-[250px]">
            {colorPresets.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                No color presets available
              </div>
            ) : (
              colorPresets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => handleColorSelect(preset.color_name, preset.hex_code, preset.filament_type)}
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
          // Auto-update printer color with the newly created preset
          handleColorSelect(preset.color_name, preset.hex_code, preset.filament_type);
        }}
      />
    </>
  );
};

export default PrinterColorSelector;