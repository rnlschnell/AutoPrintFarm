import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Info, Loader2 } from "lucide-react";
import { usePrintJobs } from "@/hooks/usePrintJobs";

interface CompleteJobModalProps {
  job: any | null;
  isOpen: boolean;
  onClose: () => void;
}

const CompleteJobModal = ({ job, isOpen, onClose }: CompleteJobModalProps) => {
  const { toast } = useToast();
  const { deletePrintJob } = usePrintJobs();
  const [notes, setNotes] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);

  if (!job) return null;

  const handleCompleteJob = async () => {
    try {
      setIsCompleting(true);

      // Log the completion notes if provided (before deletion)
      if (notes.trim()) {
        console.log(`Print job ${job.id} (${job.fileName}) completed with notes: ${notes}`);
      }

      console.log(`Attempting to complete and remove job ${job.id} (${job.fileName})`);

      // Delete the job completely from the database
      await deletePrintJob(job.id);

      toast({
        title: "Job Completed Successfully",
        description: `${job.fileName} has been marked as complete and removed from the queue.`,
      });

      onClose();
    } catch (error) {
      console.error('Error completing job:', error);

      // Show more specific error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      toast({
        title: "Failed to Complete Job",
        description: `Could not complete ${job.fileName}: ${errorMessage}. Please try again or contact support if the issue persists.`,
        variant: "destructive",
      });
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Complete Job - {job.fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <Info className="h-4 w-4 text-green-600" />
            <p className="text-sm text-green-800">
              This will remove the completed job from the queue. This action cannot be undone.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Completion Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about the completed job..."
                rows={4}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isCompleting}>
              Keep in Queue
            </Button>
            <Button onClick={handleCompleteJob} disabled={isCompleting} className="bg-green-600 hover:bg-green-700">
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                "Complete & Remove"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CompleteJobModal;