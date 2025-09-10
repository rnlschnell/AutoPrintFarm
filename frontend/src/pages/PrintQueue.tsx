
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
import { MoreHorizontal, List, Kanban, Plus } from "lucide-react";
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
import CreateJobModal from "@/components/CreateJobModal";
import ColorSwatch from "@/components/ColorSwatch";

// Remove old mock data

const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
        case 'printing':
            return <Badge className="bg-blue-600 text-white hover:bg-blue-700">{status}</Badge>;
        case 'completed':
            return <Badge className="bg-green-600 text-white hover:bg-green-700">{status}</Badge>;
        case 'queued':
            return <Badge className="bg-orange-500 text-white hover:bg-orange-600">{status}</Badge>;
        case 'failed':
            return <Badge variant="destructive">{status}</Badge>;
        case 'cancelled':
            return <Badge className="bg-gray-500 text-white hover:bg-gray-600">{status}</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
};

const KanbanColumn = ({ title, jobs, status, onViewDetails, onCancelJob }: { title: string; jobs: any[]; status: string; onViewDetails: (job: any) => void; onCancelJob: (job: any) => void; }) => {
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
              {job.status === 'Printing' && (
                <div className="flex items-center gap-2 mb-2">
                  <Progress value={job.progress} className="flex-1" />
                  <span className="text-xs text-muted-foreground">{job.progress}%</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                {getStatusBadge(job.status)}
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const PrintQueue = () => {
  const { printJobs: jobs, loading, addPrintJob } = usePrintJobs();
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [selectedJob, setSelectedJob] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCreateJobModalOpen, setIsCreateJobModalOpen] = useState(false);

  const handleViewDetails = (job: any) => {
    setSelectedJob(job);
    setIsDetailsModalOpen(true);
  };

  const handleCancelJob = (job: any) => {
    setSelectedJob(job);
    setIsCancelModalOpen(true);
  };

  const handleCreateJob = async (jobData: {
    printFileId: string;
    fileName: string;
    color: string;
    filamentType: string;
    materialType: string;
    printerId?: string;
    numberOfUnits: number;
  }) => {
    try {
      await addPrintJob(jobData);
    } catch (error) {
      // Error handled by hook
    }
  };

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
              variant={viewMode === 'table' ? 'secondary' : 'ghost'} 
              size="sm" 
              onClick={() => setViewMode('table')}
              className="h-8"
            >
              <List className="h-4 w-4 mr-2" />
              Table
            </Button>
            <Button 
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'} 
              size="sm" 
              onClick={() => setViewMode('kanban')}
              className="h-8"
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
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Color</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell 
                      className="font-medium truncate max-w-48 cursor-pointer hover:text-primary" 
                      onClick={() => handleViewDetails(job)}
                    >
                      {job.fileName}
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <ColorSwatch color={job.color} size="sm" />
                        <span className="text-sm">{job.color.split('|')[0]}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            <Progress value={job.progressPercentage || 0} className="w-20" />
                            <span className="text-xs text-muted-foreground">{job.progressPercentage || 0}%</span>
                        </div>
                    </TableCell>
                    <TableCell>
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
                          <DropdownMenuItem onClick={() => handleCancelJob(job)}>Cancel Job</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
              jobs={jobs}
              status={column.status}
              onViewDetails={handleViewDetails}
              onCancelJob={handleCancelJob}
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

      <CreateJobModal
        isOpen={isCreateJobModalOpen}
        onClose={() => setIsCreateJobModalOpen(false)}
        onCreateJob={handleCreateJob}
      />
    </div>
  );
};

export default PrintQueue;
