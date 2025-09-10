
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Wrench, AlertTriangle } from "lucide-react";

interface PrinterMaintenanceModalProps {
  printer: any | null;
  isOpen: boolean;
  onClose: () => void;
}

const PrinterMaintenanceModal = ({ printer, isOpen, onClose }: PrinterMaintenanceModalProps) => {
  const { toast } = useToast();
  const [maintenanceType, setMaintenanceType] = useState("");
  const [notes, setNotes] = useState("");

  if (!printer) return null;

  const handleStartMaintenance = () => {
    if (!maintenanceType) {
      toast({
        title: "Error",
        description: "Please select a maintenance type.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Maintenance Started",
      description: `${maintenanceType} maintenance has been started for ${printer.name}.`,
    });
    onClose();
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
              <Select value={maintenanceType} onValueChange={setMaintenanceType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select maintenance type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine Cleaning</SelectItem>
                  <SelectItem value="nozzle">Nozzle Replacement</SelectItem>
                  <SelectItem value="bed-leveling">Bed Leveling</SelectItem>
                  <SelectItem value="calibration">Calibration</SelectItem>
                  <SelectItem value="firmware">Firmware Update</SelectItem>
                  <SelectItem value="repair">Repair</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes about this maintenance..."
                rows={4}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleStartMaintenance}>Start Maintenance</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PrinterMaintenanceModal;
