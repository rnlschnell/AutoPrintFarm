
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { usePrintJobs } from "@/hooks/usePrintJobs";

interface CancelJobModalProps {
  job: any | null;
  isOpen: boolean;
  onClose: () => void;
}

const CancelJobModal = ({ job, isOpen, onClose }: CancelJobModalProps) => {
  const { toast } = useToast();
  const { deletePrintJob } = usePrintJobs();
  const [reason, setReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  if (!job) return null;

  const handleCancelJob = async () => {
    try {
      setIsDeleting(true);
      
      // Log the cancellation reason if provided (before deletion)
      if (reason.trim()) {
        console.log(`Print job ${job.id} (${job.fileName}) cancelled with reason: ${reason}`);
      }
      
      console.log(`Attempting to delete job ${job.id} (${job.fileName})`);
      
      // Delete the job completely from the database
      await deletePrintJob(job.id);
      
      toast({
        title: "Job Cancelled Successfully",
        description: `${job.fileName} has been cancelled and removed from the queue. Any active print has been stopped.`,
      });
      
      onClose();
    } catch (error) {
      console.error('Error cancelling job:', error);
      
      // Show more specific error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      toast({
        title: "Failed to Cancel Job",
        description: `Could not cancel ${job.fileName}: ${errorMessage}. Please try again or contact support if the issue persists.`,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" />
            Cancel Job - {job.fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <p className="text-sm text-red-800">
              This action cannot be undone. The job will be permanently removed from the queue.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Cancellation Reason (Optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter the reason for cancelling this job..."
                rows={4}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isDeleting}>
              Keep Job
            </Button>
            <Button variant="destructive" onClick={handleCancelJob} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Cancel Job"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CancelJobModal;
