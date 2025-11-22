import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

interface CameraViewModalProps {
  printerId: string | null;
  printerName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface CameraSnapshot {
  image_data: string;
  timestamp: string;
  resolution: string;
}

interface CameraResponse {
  success: boolean;
  message: string;
  printer_id: string;
  snapshot: CameraSnapshot;
}

const CameraViewModal = ({ printerId, printerName, isOpen, onClose }: CameraViewModalProps) => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [timestamp, setTimestamp] = useState<string>("");
  const [resolution, setResolution] = useState<string>("");
  const { toast } = useToast();

  const fetchSnapshot = async () => {
    if (!printerId) return;

    try {
      const response = await fetch(`/api/printers/${printerId}/camera/snapshot`);

      if (!response.ok) {
        throw new Error('Failed to fetch camera snapshot');
      }

      const data: CameraResponse = await response.json();

      if (data.snapshot && data.snapshot.image_data) {
        setImageData(data.snapshot.image_data);
        setTimestamp(new Date(data.snapshot.timestamp).toLocaleString());
        setResolution(data.snapshot.resolution);
        // Clear loading state - always set to ensure it's false
        setIsLoading(false);
      } else {
        throw new Error('Invalid snapshot data received');
      }
    } catch (error) {
      console.error('Error fetching snapshot:', error);
      if (isLoading) {
        // Only show error toast on initial load
        toast({
          title: "Error",
          description: "Failed to fetch camera snapshot. Please try again.",
          variant: "destructive",
        });
        setIsLoading(false);
      }
    }
  };

  const stopCamera = async () => {
    if (!printerId) return;

    try {
      await fetch(`/api/printers/${printerId}/camera/stop`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Error stopping camera:', error);
    }
  };

  // Start 15 FPS polling when modal opens, stop and cleanup when it closes
  useEffect(() => {
    if (isOpen && printerId) {
      setIsLoading(true);
      // Fetch initial frame
      fetchSnapshot();

      // Start polling at 15 FPS (67ms interval)
      const intervalId = setInterval(fetchSnapshot, 67);

      // Cleanup on modal close
      return () => {
        clearInterval(intervalId);
        stopCamera();
        setImageData(null);
        setTimestamp("");
        setResolution("");
        setIsLoading(false);
      };
    }
  }, [isOpen, printerId]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {printerName} - Live Camera View
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera Image Display */}
          <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden" style={{ minHeight: "400px" }}>
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500">Starting camera feed...</p>
                </div>
              </div>
            ) : imageData ? (
              <img
                src={`data:image/jpeg;base64,${imageData}`}
                alt="Printer camera view"
                className="w-full h-auto"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <Camera className="h-12 w-12 text-gray-300" />
                  <p className="text-sm text-gray-500">No image available</p>
                </div>
              </div>
            )}
          </div>

          {/* Image Info */}
          {timestamp && resolution && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Last updated: {timestamp}</span>
              <span>Resolution: {resolution}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CameraViewModal;
