
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Wrench, AlertTriangle } from "lucide-react";

interface PrinterMaintenanceModalProps {
  printer: any | null;
  isOpen: boolean;
  onClose: () => void;
  onMaintenanceStarted?: () => void;
}

const PrinterMaintenanceModal = ({ printer, isOpen, onClose, onMaintenanceStarted }: PrinterMaintenanceModalProps) => {
  const { toast } = useToast();
  const [maintenanceType, setMaintenanceType] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!printer) return null;

  const handleStartMaintenance = async () => {
    if (!maintenanceType) {
      toast({
        title: "Error",
        description: "Please select a maintenance type.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Call the new maintenance/start endpoint
      const response = await fetch(`/api/printers/${printer.id}/maintenance/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maintenance_type: maintenanceType,
          notes: null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to start maintenance: ${response.statusText}`);
      }

      const result = await response.json();

      toast({
        title: "Maintenance Started",
        description: `${maintenanceType} maintenance has been started for ${printer.name}. A worklist task has been created.`,
      });

      // Call the callback to refresh printer data
      if (onMaintenanceStarted) {
        onMaintenanceStarted();
      }

      onClose();
    } catch (error) {
      console.error('Error starting maintenance:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start maintenance. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Start Maintenance - {printer.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <p className="text-sm text-yellow-800">
              This will put the printer in maintenance mode and pause any current jobs.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maintenanceType">Maintenance Type *</Label>
              <Select value={maintenanceType} onValueChange={setMaintenanceType} disabled={isSubmitting}>
                <SelectTrigger>
                  <SelectValue placeholder="Select maintenance type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Routine Cleaning">Routine Cleaning</SelectItem>
                  <SelectItem value="Nozzle Replacement">Nozzle Replacement</SelectItem>
                  <SelectItem value="Bed Leveling">Bed Leveling</SelectItem>
                  <SelectItem value="Calibration">Calibration</SelectItem>
                  <SelectItem value="Firmware Update">Firmware Update</SelectItem>
                  <SelectItem value="Repair">Repair</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleStartMaintenance} disabled={isSubmitting}>
              {isSubmitting ? "Starting..." : "Start Maintenance"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PrinterMaintenanceModal;
