import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Settings, AlertTriangle } from "lucide-react";
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

interface CalibrationModalProps {
  printer: any | null;
  isOpen: boolean;
  onClose: () => void;
}

const CalibrationModal = ({ printer, isOpen, onClose }: CalibrationModalProps) => {
  const { toast } = useToast();
  const [bedLevel, setBedLevel] = useState(true);
  const [vibrationCompensation, setVibrationCompensation] = useState(true);
  const [motorNoiseCalibration, setMotorNoiseCalibration] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);

  if (!printer) return null;

  const handleStartCalibration = () => {
    // Check if at least one calibration is selected
    if (!bedLevel && !vibrationCompensation && !motorNoiseCalibration) {
      toast({
        title: "Error",
        description: "Please select at least one calibration to run.",
        variant: "destructive",
      });
      return;
    }

    // Show confirmation dialog
    setShowConfirmation(true);
  };

  const handleConfirmCalibration = async () => {
    setShowConfirmation(false);
    setIsCalibrating(true);

    try {
      const response = await fetch(`/api/printers/${printer.printerId}/calibrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bed_level: bedLevel,
          vibration_compensation: vibrationCompensation,
          motor_noise_calibration: motorNoiseCalibration,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start calibration');
      }

      const result = await response.json();

      toast({
        title: "Calibration Started",
        description: result.message || "Printer calibration started successfully",
      });

      onClose();
    } catch (error) {
      console.error('Error starting calibration:', error);
      toast({
        title: "Error",
        description: "Failed to start printer calibration",
        variant: "destructive",
      });
    } finally {
      setIsCalibrating(false);
    }
  };

  const getSelectedCalibrations = () => {
    const calibrations = [];
    if (bedLevel) calibrations.push("Bed Level");
    if (vibrationCompensation) calibrations.push("Vibration Compensation");
    if (motorNoiseCalibration) calibrations.push("Motor Noise Calibration");
    return calibrations.join(", ");
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Calibrate Printer - {printer.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Critical Warning */}
            <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-900">
                  IMPORTANT: Before Starting Calibration
                </p>
                <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                  <li>Ensure the printer bed is completely clear</li>
                  <li>Install a clean build plate on the printer</li>
                  <li>Verify no filament is loaded or printing in progress</li>
                  <li>Calibration may take several minutes to complete</li>
                </ul>
              </div>
            </div>

            {/* Calibration Options */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Select Calibrations to Run</Label>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="bedLevel"
                    checked={bedLevel}
                    onCheckedChange={(checked) => setBedLevel(checked as boolean)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="bedLevel" className="font-medium cursor-pointer">
                      Bed Level
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Calibrates the bed level for optimal first layer adhesion
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="vibrationCompensation"
                    checked={vibrationCompensation}
                    onCheckedChange={(checked) => setVibrationCompensation(checked as boolean)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="vibrationCompensation" className="font-medium cursor-pointer">
                      Vibration Compensation
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Calibrates vibration compensation for better print quality
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="motorNoiseCalibration"
                    checked={motorNoiseCalibration}
                    onCheckedChange={(checked) => setMotorNoiseCalibration(checked as boolean)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="motorNoiseCalibration" className="font-medium cursor-pointer">
                      Motor Noise Calibration
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Calibrates motor noise for quieter operation
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isCalibrating}>
                Cancel
              </Button>
              <Button onClick={handleStartCalibration} disabled={isCalibrating}>
                {isCalibrating ? "Starting..." : "Start Calibration"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Confirm Calibration
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                You are about to start the following calibrations on <strong>{printer.name}</strong>:
              </p>
              <p className="font-medium text-foreground">
                {getSelectedCalibrations()}
              </p>
              <p className="text-destructive font-semibold">
                Have you confirmed that the printer bed is clear and a clean build plate is installed?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCalibration}>
              Yes, Start Calibration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default CalibrationModal;
