import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FrontendPrinter } from "@/lib/transformers";

interface FilamentLevelModalProps {
  open: boolean;
  onClose: () => void;
  printer: FrontendPrinter;
  onUpdateFilament: (printerId: string, filamentLevel: number) => Promise<void>;
}

export function FilamentLevelModal({
  open,
  onClose,
  printer,
  onUpdateFilament
}: FilamentLevelModalProps) {
  const [filamentLevel, setFilamentLevel] = useState(printer.filamentLevel || 0);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      await onUpdateFilament(printer.id, filamentLevel);
      onClose();
    } catch (error) {
      console.error('Failed to update filament level:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Update Filament Level</DialogTitle>
          <DialogDescription>
            Update the available filament for {printer.name}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="filament" className="text-right">
              Filament (g)
            </Label>
            <Input
              id="filament"
              type="number"
              min="0"
              value={filamentLevel}
              onChange={(e) => setFilamentLevel(parseInt(e.target.value) || 0)}
              className="col-span-3"
              placeholder="Enter filament amount in grams"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Enter the amount of filament available on this printer in grams.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isUpdating}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isUpdating}>
            {isUpdating ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}