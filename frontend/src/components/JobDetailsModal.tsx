
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { FileText, Package, Clock, Calendar, Printer } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";

interface JobDetailsModalProps {
  job: any | null;
  isOpen: boolean;
  onClose: () => void;
}

const JobDetailsModal = ({ job, isOpen, onClose }: JobDetailsModalProps) => {
  if (!job) return null;

  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'Printing': return 'default';
      case 'Completed': return 'secondary';
      case 'Queued': return 'outline';
      case 'Failed': return 'destructive';
      default: return 'outline';
    }
  };

  // Add default color if not present
  const jobColor = job.color || 'Galaxy Black|#1a1a1a';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Job Details - {job.fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">File Name</span>
              <p className="text-lg">{job.fileName}</p>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              <div>
                <Badge variant={getBadgeVariant(job.status)}>{job.status}</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Source</span>
              <p className="text-lg">{job.source || 'Manual'}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Job Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">SKU</p>
                  <p className="font-medium">SKU-{job.fileName.replace(/\.[^/.]+$/, "").slice(0, 6).toUpperCase()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">Submitted</p>
                  <p className="font-medium">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">Est. Print Time</p>
                  <p className="font-medium">2h 30m</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ColorSwatch color={jobColor} size="sm" />
                <div>
                  <p className="text-muted-foreground">Color</p>
                  <p className="font-medium">{jobColor.split('|')[0]}</p>
                </div>
              </div>
            </div>
          </div>

          {job.status === 'Printing' && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Progress</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Completion</span>
                    <span>{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-3" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Layer 125 of 180</span>
                    <span>1h 15m remaining</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">File Properties</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">File Size:</span>
                <span>15.2 MB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Material:</span>
                <span>PLA</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Number of Units:</span>
                <span>3</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Filament Needed:</span>
                <span>450g</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {job.status === 'Queued' && (
              <Button variant="destructive">Cancel Job</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailsModal;
