import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { FileText, Package, Clock, Calendar, Printer } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";
import { FrontendPrintJob } from "@/lib/transformers";

interface JobDetailsModalProps {
  job: FrontendPrintJob | null;
  isOpen: boolean;
  onClose: () => void;
}

const JobDetailsModal = ({ job, isOpen, onClose }: JobDetailsModalProps) => {
  if (!job) return null;

  // Helper function to format time ago
  const formatTimeAgo = (isoDate?: string): string => {
    if (!isoDate) return 'N/A';
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  // Helper function to format duration from minutes
  const formatDuration = (minutes?: number): string => {
    if (!minutes) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  // Helper function to format date/time
  const formatDateTime = (isoDate?: string): string => {
    if (!isoDate) return 'N/A';
    const date = new Date(isoDate);
    return date.toLocaleString();
  };

  // Helper function to calculate remaining time
  const calculateRemainingTime = (estimatedMins?: number, progressPercent?: number): string => {
    if (!estimatedMins || !progressPercent || progressPercent === 0) return 'N/A';
    const remainingMins = Math.ceil((estimatedMins * (100 - progressPercent)) / 100);
    return formatDuration(remainingMins);
  };

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
              <span className="text-sm font-medium text-muted-foreground">Submitted By</span>
              <p className="text-lg">{job.submittedBy || 'System'}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Job Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">Est. Print Time</p>
                  <p className="font-medium">{formatDuration(job.estimatedPrintTimeMinutes)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ColorSwatch color={jobColor} size="sm" />
                <div>
                  <p className="text-muted-foreground">Color</p>
                  <p className="font-medium">{jobColor.split('|')[0]}</p>
                </div>
              </div>
              {job.productName && (
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground">Product</p>
                    <p className="font-medium">{job.productName}</p>
                  </div>
                </div>
              )}
              {job.skuName && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground">SKU</p>
                    <p className="font-medium">{job.skuName}</p>
                  </div>
                </div>
              )}
              {job.timeStarted && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground">Started</p>
                    <p className="font-medium">{formatDateTime(job.timeStarted)}</p>
                  </div>
                </div>
              )}
              {job.timeCompleted && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground">Completed</p>
                    <p className="font-medium">{formatDateTime(job.timeCompleted)}</p>
                  </div>
                </div>
              )}
              {job.actualPrintTimeMinutes && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground">Actual Print Time</p>
                    <p className="font-medium">{formatDuration(job.actualPrintTimeMinutes)}</p>
                  </div>
                </div>
              )}
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
                    <span>{job.progressPercentage || 0}%</span>
                  </div>
                  <Progress value={job.progressPercentage || 0} className="h-3" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    {job.liveData?.progress?.current_layer && job.liveData?.progress?.total_layers ? (
                      <span>Layer {job.liveData.progress.current_layer} of {job.liveData.progress.total_layers}</span>
                    ) : (
                      <span>&nbsp;</span>
                    )}
                    <span>{calculateRemainingTime(job.estimatedPrintTimeMinutes, job.progressPercentage)}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Print Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {(job.printerName || job.printerNumericId || job.printerModel) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Printer:</span>
                  <span>
                    {job.printerName || `#${job.printerNumericId} - ${job.printerModel}`}
                    {job.printerName && job.printerNumericId && ` (#${job.printerNumericId})`}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Material:</span>
                <span>{job.materialType || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Filament Type:</span>
                <span>{job.filamentType || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Copies:</span>
                <span>{job.numberOfUnits || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Objects/Copy:</span>
                <span>{job.quantityPerPrint || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Filament Needed:</span>
                <span>{job.filamentNeededGrams ? `${job.filamentNeededGrams}g` : 'N/A'}</span>
              </div>
              {job.requiresAssembly && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requires Assembly:</span>
                  <Badge variant="outline" className="ml-auto">Yes</Badge>
                </div>
              )}
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
