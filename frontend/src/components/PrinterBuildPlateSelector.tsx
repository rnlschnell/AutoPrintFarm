import { useState } from "react";
import { Pencil, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Printer } from "@/hooks/usePrinters";
import { useToast } from "@/hooks/use-toast";

// Hardcoded build plate options
const BUILD_PLATE_TYPES = [
  "Smooth Cool Plate",
  "Engineering Plate",
  "Smooth High Temp Plate",
  "Textured PEI Plate",
  "Textured Cool Plate",
  "Cool Plate (SuperTack)",
];

interface PrinterBuildPlateSelectorProps {
  printer: Printer;
  variant?: 'icon' | 'inline';
  updatePrinter: (id: string, updates: Partial<Printer>) => Promise<Printer>;
}

const PrinterBuildPlateSelector = ({ printer, variant = 'icon', updatePrinter }: PrinterBuildPlateSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleBuildPlateSelect = async (plateName: string) => {
    try {
      await updatePrinter(printer.id, {
        currentBuildPlate: plateName,
      });

      setIsOpen(false);
    } catch (error) {
      console.error('Error updating printer build plate:', error);
      toast({
        title: "Error",
        description: "Failed to update printer build plate.",
        variant: "destructive",
      });
    }
  };

  // Inline variant: clickable text with hover effect
  if (variant === 'inline') {
    return (
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <span className="group-hover:underline">{printer.currentBuildPlate || 'No plate set'}</span>
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 bg-background border shadow-lg z-50">
          {BUILD_PLATE_TYPES.map((plateName) => (
            <DropdownMenuItem
              key={plateName}
              onClick={() => handleBuildPlateSelect(plateName)}
              className="flex items-center gap-3 cursor-pointer hover:bg-muted"
            >
              <span className="font-medium">{plateName}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Icon variant (default): pencil icon button
  return (
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
      <DropdownMenuContent align="end" className="w-56 bg-background border shadow-lg z-50">
        {BUILD_PLATE_TYPES.map((plateName) => (
          <DropdownMenuItem
            key={plateName}
            onClick={() => handleBuildPlateSelect(plateName)}
            className="flex items-center gap-3 cursor-pointer hover:bg-muted"
          >
            <span className="font-medium">{plateName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PrinterBuildPlateSelector;
