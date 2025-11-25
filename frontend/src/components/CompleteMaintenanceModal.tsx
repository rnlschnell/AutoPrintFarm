import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Wrench, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

interface CompleteMaintenanceModalProps {
  printer: any | null;
  isOpen: boolean;
  onClose: () => void;
  onMaintenanceCompleted?: () => void;
}

const CompleteMaintenanceModal = ({ printer, isOpen, onClose, onMaintenanceCompleted }: CompleteMaintenanceModalProps) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!printer) return null;

  const handleCompleteMaintenance = async () => {
    setIsSubmitting(true);

    try {
      // Find the associated worklist task using cloud API
      const tasksResponse = await api.get<{
        success: boolean;
        data: any[];
      }>(`/api/v1/worklist`, {
        params: {
          status: 'in_progress',
          task_type: 'maintenance',
          printer_id: printer.id
        }
      });

      const tasks = tasksResponse.data || [];
      const maintenanceTask = tasks.find((task: any) =>
        task.printer_id === printer.id &&
        task.task_type === 'maintenance' &&
        task.status === 'in_progress'
      );

      if (maintenanceTask) {
        // Use cloud API to complete the maintenance task
        await api.post(`/api/v1/worklist/${maintenanceTask.id}/complete`, {});

        // Also update the printer status via cloud API
        await api.put(`/api/v1/printers/${printer.id}`, {
          in_maintenance: false,
          maintenance_type: null,
          status: 'idle',
        });
      } else {
        // Fallback: No task found, just update printer directly via cloud API
        await api.put(`/api/v1/printers/${printer.id}`, {
          in_maintenance: false,
          maintenance_type: null,
          status: 'idle',
        });
      }

      toast({
        title: "Maintenance Completed",
        description: `${printer.name} is back in service.`,
      });

      // Call the callback to refresh printer data
      if (onMaintenanceCompleted) {
        onMaintenanceCompleted();
      }

      onClose();
    } catch (error) {
      console.error('Error completing maintenance:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to complete maintenance. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-yellow-600" />
            Complete Maintenance - {printer.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-full">
                <Wrench className="h-5 w-5 text-yellow-700" />
              </div>
              <div>
                <div className="text-sm font-medium text-yellow-900">Current Maintenance</div>
                <div className="text-xs text-yellow-700 mt-0.5">
                  {printer.maintenanceType || "Unknown Type"}
                </div>
              </div>
            </div>
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
              In Progress
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            Are you sure you want to complete this maintenance? The printer will be marked as available for printing again.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCompleteMaintenance} disabled={isSubmitting} className="gap-2">
            {isSubmitting ? (
              "Completing..."
            ) : (
              <>
                <CheckCircle className="h-4 w-4" />
                Complete Maintenance
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompleteMaintenanceModal;
