import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle, Clock, X, Wrench, Package, Printer, ClipboardList, AlertCircle } from 'lucide-react';
import { useWorklistTasks, WorklistTask } from '@/hooks/useWorklistTasks';
import { useWikis } from '@/hooks/useWikis';
import { useToast } from '@/hooks/use-toast';
import { WikiViewer } from '@/components/wiki/WikiViewer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const TaskDetailPage = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { tasks, loading: tasksLoading, completeTask, completeTaskForced, checkInventoryAvailability, cancelTask, getElapsedTime } = useWorklistTasks();
  const { getWiki, getWikiByProductSku, loading: wikiLoading } = useWikis();
  const { toast } = useToast();

  const [task, setTask] = useState<WorklistTask | null>(null);
  const [wiki, setWiki] = useState<any>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [inventoryConfirmation, setInventoryConfirmation] = useState<{
    shortages: Array<{ componentName: string; needed: number; available: number }>;
  } | null>(null);
  const [assemblyTaskData, setAssemblyTaskData] = useState<{
    product_name: string;
    sku: string;
    quantity: number;
    notes?: string;
    created_at: string;
  } | null>(null);

  // Fetch task from tasks array
  useEffect(() => {
    const currentTask = tasks.find(t => t.id === taskId);
    if (currentTask) {
      setTask(currentTask);

      // Initialize elapsed time for in-progress tasks
      if (currentTask.status === 'in_progress' && currentTask.started_at) {
        const utcStartedAt = currentTask.started_at.endsWith('Z') ? currentTask.started_at : currentTask.started_at + 'Z';
        const start = new Date(utcStartedAt);
        const now = new Date();
        const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
        setElapsedSeconds(seconds);
      }
    }
  }, [taskId, tasks]);

  // Fetch assembly task data for assembly tasks
  useEffect(() => {
    if (task?.task_type === 'assembly' && task?.assembly_task_id && !assemblyTaskData) {
      fetchAssemblyTaskData(task.assembly_task_id);
    }
  }, [task?.assembly_task_id]);

  // Fetch wiki only when task changes and wiki not already loaded
  useEffect(() => {
    if (task?.task_type === 'assembly' && task?.assembly_task_id && !wiki) {
      fetchWikiForTask(task.assembly_task_id);
    }
  }, [task?.assembly_task_id]);

  // Update elapsed time every second for in-progress tasks
  useEffect(() => {
    if (task?.status === 'in_progress' && task?.started_at) {
      const interval = setInterval(() => {
        const utcStartedAt = task.started_at!.endsWith('Z') ? task.started_at! : task.started_at! + 'Z';
        const start = new Date(utcStartedAt);
        const now = new Date();
        const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
        setElapsedSeconds(seconds);
      }, 1000); // Update every second

      return () => clearInterval(interval);
    }
  }, [task]);

  const fetchAssemblyTaskData = async (assemblyTaskId: string) => {
    try {
      const response = await fetch(`/api/assembly-tasks/${assemblyTaskId}`);
      if (response.ok) {
        const data = await response.json();
        setAssemblyTaskData({
          product_name: data.product_name,
          sku: data.sku,
          quantity: data.quantity,
          notes: data.notes,
          created_at: data.created_at,
        });
      }
    } catch (error) {
      console.error('Error fetching assembly task data:', error);
      // Don't show error - continue without assembly data
    }
  };

  const fetchWikiForTask = async (assemblyTaskId: string) => {
    try {
      // Get wiki_id from backend API
      const response = await fetch(`/api/assembly-tasks/${assemblyTaskId}/wiki`);
      if (response.ok) {
        const data = await response.json();
        if (data.wiki_id) {
          // Use the useWikis hook's getWiki function to fetch from Supabase
          const wikiData = await getWiki(data.wiki_id);
          if (wikiData) {
            setWiki(wikiData);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching wiki:', error);
      // Don't show error - wiki is optional
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'warning';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'in_progress': return <Clock className="h-5 w-5 text-blue-500" />;
      case 'pending': return <ClipboardList className="h-5 w-5 text-yellow-500" />;
      case 'cancelled': return <X className="h-5 w-5 text-red-500" />;
      default: return <Clock className="h-5 w-5" />;
    }
  };

  const getTypeIcon = (task_type: string) => {
    switch (task_type) {
      case 'filament_change': return <Printer className="h-5 w-5" />;
      case 'collection': return <Package className="h-5 w-5" />;
      case 'assembly': return <Wrench className="h-5 w-5" />;
      case 'maintenance': return <Wrench className="h-5 w-5" />;
      case 'quality_check': return <CheckCircle className="h-5 w-5" />;
      default: return <Clock className="h-5 w-5" />;
    }
  };

  const formatElapsedTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const formatElapsedTimeSeconds = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCompleteWithInventoryCheck = async () => {
    if (!task) return;

    // Only check inventory for assembly tasks
    if (task.task_type === 'assembly' && task.assembly_task_id) {
      try {
        const inventoryCheck = await checkInventoryAvailability(task.assembly_task_id);

        if (inventoryCheck.hasShortage) {
          // Show confirmation modal
          setInventoryConfirmation({ shortages: inventoryCheck.shortages });
          return;
        }
      } catch (error) {
        console.error('Error checking inventory:', error);
        toast({
          title: "Error",
          description: "Failed to check inventory availability",
          variant: "destructive",
        });
        return;
      }
    }

    // No shortage or not an assembly task - proceed normally
    await completeTask(task.id);
    navigate('/worklist');
  };

  const handleConfirmInventoryShortage = async () => {
    if (task && inventoryConfirmation) {
      await completeTaskForced(task.id);
      setInventoryConfirmation(null);
      navigate('/worklist');
    }
  };

  const handleCancel = async () => {
    if (task) {
      await cancelTask(task.id);
      navigate('/worklist');
    }
  };

  if (tasksLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg text-muted-foreground">Loading task...</div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="container mx-auto p-6">
        <Button variant="ghost" onClick={() => navigate('/worklist')} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Worklist
        </Button>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">Task not found</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 pb-6 max-w-screen-2xl">
      {/* Back Button */}
      <Button variant="ghost" onClick={() => navigate('/worklist')} className="-mt-2 mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Worklist
      </Button>

      {/* Task Overview Card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1">
              {getTypeIcon(task.task_type)}
              <div className="flex-1">
                <CardTitle className="text-2xl mb-2">{task.title}</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={getPriorityColor(task.priority)}>
                    {task.priority.toUpperCase()}
                  </Badge>
                  <div className="flex items-center gap-1">
                    {getStatusIcon(task.status)}
                    <span className="text-sm text-muted-foreground capitalize">
                      {task.status === 'pending' ? 'To Do' : task.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {task.description && (
            <p className="text-muted-foreground mb-4">{task.description}</p>
          )}

          {/* Assembly Task Overview (for assembly tasks only) */}
          {task.task_type === 'assembly' && assemblyTaskData && (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Overview</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs font-medium text-slate-500">Product Name</span>
                    <p className="text-sm font-medium text-slate-900">{assemblyTaskData.product_name}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500">SKU</span>
                    <p className="text-sm font-medium text-slate-900">{assemblyTaskData.sku}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500">Number of Units</span>
                    <p className="text-sm font-medium text-slate-900">{assemblyTaskData.quantity}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500">Created</span>
                    <p className="text-sm font-medium text-slate-900">
                      {new Date(assemblyTaskData.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Notes box (only if notes exist) */}
              {assemblyTaskData.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <h3 className="text-xs font-semibold text-amber-700 mb-1">Notes</h3>
                  <p className="text-sm text-amber-900">{assemblyTaskData.notes}</p>
                </div>
              )}
            </>
          )}

          {/* Task Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {task.estimated_time_minutes && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Estimated Time:</span>
                <p className="text-lg">{formatElapsedTime(task.estimated_time_minutes)}</p>
              </div>
            )}

            {task.status === 'in_progress' && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Elapsed Time:</span>
                <p className="text-lg font-semibold text-blue-600">{formatElapsedTimeSeconds(elapsedSeconds)}</p>
              </div>
            )}

            {task.status === 'completed' && task.actual_time_minutes && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Completed In:</span>
                <p className="text-lg font-semibold text-green-600">{formatElapsedTime(task.actual_time_minutes)}</p>
              </div>
            )}

            {task.assigned_to && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Assigned To:</span>
                <p className="text-lg">{task.assigned_to}</p>
              </div>
            )}

            {task.order_number && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Order Number:</span>
                <p className="text-lg">{task.order_number}</p>
              </div>
            )}

            {task.printer_id && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Build Plate Needed:</span>
                <p className="text-lg">{task.metadata?.build_plate_needed || 'Unknown'}</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {task.status === 'in_progress' && (
            <div className="flex gap-2">
              <Button onClick={handleCompleteWithInventoryCheck} className="flex-1" size="lg">
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Task
              </Button>
              <Button onClick={handleCancel} variant="outline" size="lg">
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          )}

          {task.status === 'completed' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <p className="text-green-800 font-medium">Task Completed</p>
            </div>
          )}

          {task.status === 'cancelled' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <X className="h-8 w-8 text-red-600 mx-auto mb-2" />
              <p className="text-red-800 font-medium">Task Cancelled</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wiki Content */}
      {wiki && task.task_type === 'assembly' && (
        <Card>
          <CardHeader>
            <CardTitle>Assembly Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <WikiViewer wiki={wiki} />
          </CardContent>
        </Card>
      )}

      {/* No Wiki Message */}
      {!wiki && !wikiLoading && task.task_type === 'assembly' && (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <p className="text-muted-foreground">No assembly instructions available for this task.</p>
          </CardContent>
        </Card>
      )}

      {/* Inventory Shortage Confirmation Dialog */}
      <AlertDialog open={!!inventoryConfirmation} onOpenChange={() => setInventoryConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Insufficient Component Inventory</AlertDialogTitle>
            <AlertDialogDescription>
              Some components required for this assembly are out of stock:
              <div className="mt-4 space-y-2">
                {inventoryConfirmation?.shortages.map((shortage, idx) => (
                  <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded p-3">
                    <p className="font-medium text-gray-900">{shortage.componentName}</p>
                    <p className="text-sm text-gray-600">
                      Need: {shortage.needed} | Available: {shortage.available} |
                      Short: {shortage.needed - shortage.available}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4">
                Do you want to complete the task anyway? Inventory levels will be set to 0 for components with insufficient stock.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmInventoryShortage}>
              Complete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TaskDetailPage;
