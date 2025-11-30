
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePrintJobs } from "@/hooks/usePrintJobs";
import { useDashboardWebSocket } from "@/hooks/useWebSocket";
import { usePrinters } from "@/hooks/usePrinters";
import { useAuth } from "@/contexts/AuthContext";
import { MoreHorizontal, List, Kanban, Plus, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import JobDetailsModal from "@/components/JobDetailsModal";
import CancelJobModal from "@/components/CancelJobModal";
import CompleteJobModal from "@/components/CompleteJobModal";
import CreateJobModalEnhanced from "@/components/CreateJobModalEnhanced";
import ColorSwatch from "@/components/ColorSwatch";
import PrintControlButtons from "@/components/PrintControlButtons";

// Remove old mock data

const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
        case 'printing':
            return <Badge className="bg-blue-600 text-white hover:bg-blue-700">{status}</Badge>;
        case 'completed':
            return <Badge className="bg-green-600 text-white hover:bg-green-700">{status}</Badge>;
        case 'queued':
            return <Badge className="bg-orange-500 text-white hover:bg-orange-600">{status}</Badge>;
        case 'processing':
            return <Badge className="bg-purple-500 text-white hover:bg-purple-600">{status}</Badge>;
        case 'uploaded':
            return <Badge className="bg-cyan-500 text-white hover:bg-cyan-600">{status}</Badge>;
        case 'failed':
            return <Badge variant="destructive">{status}</Badge>;
        case 'cancelled':
            return <Badge className="bg-gray-500 text-white hover:bg-gray-600">{status}</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
};

const KanbanColumn = ({ title, jobs, status, onViewDetails, onCancelJob, onCompleteJob, getPrinterNumericId }: { title: string; jobs: any[]; status: string; onViewDetails: (job: any) => void; onCancelJob: (job: any) => void; onCompleteJob: (job: any) => void; getPrinterNumericId: (printerUuid: string) => string; }) => {
  const filteredJobs = jobs.filter(job => job.status.toLowerCase() === status.toLowerCase());
  
  return (
    <div className="flex flex-col min-h-[600px] bg-muted/20 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{title}</h3>
        <Badge variant="secondary">{filteredJobs.length}</Badge>
      </div>
      <div className="space-y-3 flex-1">
        {filteredJobs.map((job) => (
          <Card key={job.id} className="cursor-move hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle 
                className="text-sm truncate cursor-pointer hover:text-primary" 
                onClick={() => onViewDetails(job)}
              >
                {job.fileName}
              </CardTitle>
              <CardDescription className="text-xs">
                <div className="flex items-center gap-2">
                  <ColorSwatch color={job.color} size="sm" />
                  <span>{job.color.split('|')[0]}</span>
                </div>
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Progress value={job.progressPercentage || 0} className="flex-1" />
                <span className="text-xs text-muted-foreground">{job.progressPercentage || 0}%</span>
                <PrintControlButtons
                  printerId={getPrinterNumericId(job.printerId || '')}
                  status={job.liveData?.status || job.status}
                />
              </div>
              <div className="flex justify-between items-center">
                {getStatusBadge(job.status)}
                <div className="flex items-center gap-1">
                  {job.status.toLowerCase() === 'completed' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onCompleteJob(job)}
                      className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
                      title="Complete & Remove Job"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost" className="h-6 w-6">
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onViewDetails(job)}>View Details</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCancelJob(job)}>Cancel Job</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const PrintQueue = () => {
  const { printJobs: jobs, loading, addPrintJob } = usePrintJobs();
  const { tenantId, session } = useAuth();
  const { data: liveData } = useDashboardWebSocket(tenantId || '', session?.token || '');
  const { printers } = usePrinters(); // Get printer data for ID lookup
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Create printer UUID to numeric ID lookup map
  const getPrinterNumericId = (printerUuid: string) => {
    const printer = printers.find(p => p.id === printerUuid);
    return printer?.printerId?.toString() || '';
  };
  const [selectedJob, setSelectedJob] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [isCreateJobModalOpen, setIsCreateJobModalOpen] = useState(false);

  const handleViewDetails = (job: any) => {
    setSelectedJob(job);
    setIsDetailsModalOpen(true);
  };

  const handleCancelJob = (job: any) => {
    setSelectedJob(job);
    setIsCancelModalOpen(true);
  };

  const handleCompleteJob = (job: any) => {
    setSelectedJob(job);
    setIsCompleteModalOpen(true);
  };

  const handleJobCreated = () => {
    // Jobs will automatically appear via real-time subscription
    // No need to manually refresh
    setIsCreateJobModalOpen(false);
  };

  // Enhanced jobs with optional live data overlay for immediate feedback
  const getEnhancedJobs = () => {
    const enhancedJobs = [...jobs]; // Start with database jobs (now kept up-to-date by backend sync service)

    if (liveData) {
      // Add live data overlay for immediate feedback (before database sync catches up)
      enhancedJobs.forEach(job => {
        // Skip completed/failed/cancelled jobs - they should not be updated by live data
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          return;
        }

        // For printing jobs, match by printer ID only (the printing job IS the current job)
        // For other jobs, also match filename to avoid false matches
        const liveInfo = liveData.find(live => {
          if (live.printer_id !== getPrinterNumericId(job.printerId || '')) {
            return false;
          }
          // If job is printing, match by printer ID alone
          if (job.status === 'printing') {
            return true;
          }
          // For other statuses, also verify filename
          return live.current_job?.filename === job.fileName;
        });

        // Handle all status transitions for active jobs only
        if (liveInfo) {
          // Store live data for additional UI info
          job.liveData = liveInfo;

          // Update progress based on live data (copying successful pattern from Printers page)
          if (liveInfo.status === 'printing') {
            // Update progress if live data is more recent
            const liveProgress = liveInfo.progress?.percent || 0;
            if (liveProgress > job.progressPercentage) {
              job.progressPercentage = liveProgress;
            }
          } else if (liveInfo.status === 'paused') {
            // Update job status to paused for UI responsiveness
            job.status = 'paused';
          } else if (liveInfo.status === 'idle' && job.status === 'printing') {
            // Job completed: printer went from printing to idle
            job.status = 'completed';
            job.progressPercentage = 100; // Ensure 100% completion
          }
        } else if (job.status === 'printing') {
          // No live data for a printing job - check if printer is idle
          const printerLiveData = liveData.find(live =>
            live.printer_id === job.printerId?.toString()
          );

          if (printerLiveData && printerLiveData.status === 'idle' && !printerLiveData.current_job) {
            // Printer is idle with no current job - job completed
            job.status = 'completed';
            job.progressPercentage = 100;
          }
        }
      });
      
      // Add external jobs that aren't in database (started outside our system)
      liveData.forEach(live => {
        if (live.current_job && live.status === 'printing') {
          const existingJob = enhancedJobs.find(job => 
            job.fileName === live.current_job?.filename &&
            job.printerId?.toString() === live.printer_id
          );
          
          if (!existingJob) {
            // Add external job as virtual entry
            enhancedJobs.unshift({
              id: `external_${live.printer_id}`,
              fileName: live.current_job.filename,
              status: 'printing',
              progressPercentage: live.progress?.percent || 0,
              printerId: parseInt(live.printer_id),
              color: 'Unknown|#808080',
              filamentType: 'Unknown',
              materialType: 'Unknown',
              quantityPerPrint: 1,
              priority: 0,
              timeSubmitted: new Date().toISOString(),
              tenantId: '',
              isExternalJob: true, // Mark as external
              liveData: live
            });
          }
        }
      });
    }
    
    return enhancedJobs;
  };

  const enhancedJobs = getEnhancedJobs();

  const statusColumns = [
    { title: 'Queued', status: 'queued' },
    { title: 'Printing', status: 'printing' },
    { title: 'Completed', status: 'completed' },
    { title: 'Failed', status: 'failed' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Print Job Queue</h1>
          <p className="text-muted-foreground">View and manage all print jobs.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsCreateJobModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Job
          </Button>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('table')}
              className={`h-8 ${viewMode === 'table' ? 'bg-white hover:bg-white' : ''}`}
            >
              <List className="h-4 w-4 mr-2" />
              Table
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('kanban')}
              className={`h-8 ${viewMode === 'kanban' ? 'bg-white hover:bg-white' : ''}`}
            >
              <Kanban className="h-4 w-4 mr-2" />
              Kanban
            </Button>
          </div>
        </div>
      </div>

      {viewMode === 'table' ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="hidden md:table-cell">Color</TableHead>
                  <TableHead>Number of Units</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enhancedJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell
                      className="font-medium truncate max-w-48 cursor-pointer hover:text-primary"
                      onClick={() => handleViewDetails(job)}
                    >
                      {job.productName || '-'}
                      {job.isExternalJob && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-1 rounded">Live</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{job.skuName || '-'}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <ColorSwatch color={job.color} size="sm" />
                        <span className="text-sm">{job.color.split('|')[0]}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{job.quantityPerPrint || 1}</span>
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            <Progress value={job.progressPercentage || 0} className="w-20" />
                            <span className="text-xs text-muted-foreground">{job.progressPercentage || 0}%</span>
                            {job.liveData?.progress?.current_layer && job.liveData?.progress?.total_layers && (
                              <span className="text-xs text-muted-foreground ml-1">
                                ({job.liveData.progress.current_layer}/{job.liveData.progress.total_layers})
                              </span>
                            )}
                            <PrintControlButtons
                              printerId={getPrinterNumericId(job.printerId || '')}
                              status={job.liveData?.status || job.status}
                            />
                        </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {job.status.toLowerCase() === 'completed' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleCompleteJob(job)}
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            title="Complete & Remove Job"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleViewDetails(job)}>View Details</DropdownMenuItem>
                            {!job.isExternalJob && (
                              <DropdownMenuItem onClick={() => handleCancelJob(job)}>Cancel Job</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statusColumns.map((column) => (
            <KanbanColumn
              key={column.status}
              title={column.title}
              jobs={enhancedJobs}
              status={column.status}
              onViewDetails={handleViewDetails}
              onCancelJob={handleCancelJob}
              onCompleteJob={handleCompleteJob}
              getPrinterNumericId={getPrinterNumericId}
            />
          ))}
        </div>
      )}

      <JobDetailsModal
        job={selectedJob}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
      />

      <CancelJobModal
        job={selectedJob}
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
      />

      <CompleteJobModal
        job={selectedJob}
        isOpen={isCompleteModalOpen}
        onClose={() => setIsCompleteModalOpen(false)}
      />

      <CreateJobModalEnhanced
        isOpen={isCreateJobModalOpen}
        onClose={() => setIsCreateJobModalOpen(false)}
        onJobCreated={handleJobCreated}
      />
    </div>
  );
};

export default PrintQueue;
