import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { CheckCircle, Clock, ClipboardList, User, Printer, Package, Wrench, X, Plus, Check, AlertCircle, Trash2 } from 'lucide-react';
import { useWorklistTasks, WorklistTask } from '@/hooks/useWorklistTasks';
import { useToast } from '@/hooks/use-toast';
import CreateTaskModal from '@/components/CreateTaskModal';
import { api } from '@/lib/api-client';

const Worklist = () => {
  const navigate = useNavigate();
  const { tasks, loading, startTask, completeTask, completeTaskForced, checkInventoryAvailability, cancelTask, getElapsedTime, createTask, deleteTask, refetch } = useWorklistTasks();
  const { toast } = useToast();
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [isClearCompletedModalOpen, setIsClearCompletedModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Restore tab from sessionStorage on refresh, default to 'pending'
    return sessionStorage.getItem('worklist-active-tab') || 'pending';
  });
  const [inventoryConfirmation, setInventoryConfirmation] = useState<{
    taskId: string;
    shortages: Array<{ componentName: string; needed: number; available: number }>;
  } | null>(null);

  // Update elapsed times for in-progress tasks
  useEffect(() => {
    const interval = setInterval(() => {
      const newElapsedTimes: Record<string, number> = {};
      tasks.filter(task => task.status === 'in_progress' && task.started_at).forEach(task => {
        newElapsedTimes[task.id] = getElapsedTime(task.started_at!);
      });
      setElapsedTimes(newElapsedTimes);
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [tasks]);

  // Initialize elapsed times
  useEffect(() => {
    const newElapsedTimes: Record<string, number> = {};
    tasks.filter(task => task.status === 'in_progress' && task.started_at).forEach(task => {
      newElapsedTimes[task.id] = getElapsedTime(task.started_at!);
    });
    setElapsedTimes(newElapsedTimes);
  }, [tasks]);

  // Save activeTab to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem('worklist-active-tab', activeTab);
  }, [activeTab]);

  // Clear sessionStorage when navigating away from the page
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('worklist-active-tab');
    };
  }, []);

  // Auto-switch to "in_progress" tab when tasks are in progress
  useEffect(() => {
    const inProgressTasks = tasks.filter(task => task.status === 'in_progress');
    // Only switch if we're on pending tab and there are in-progress tasks
    if (activeTab === 'pending' && inProgressTasks.length > 0) {
      setActiveTab('in_progress');
    }
  }, [tasks]);

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
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in_progress': return <Clock className="h-4 w-4 text-blue-500" />;
      case 'pending': return <ClipboardList className="h-4 w-4 text-yellow-500" />;
      case 'cancelled': return <X className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getTypeIcon = (task_type: string) => {
    switch (task_type) {
      case 'filament_change': return <Printer className="h-4 w-4" />;
      case 'collection': return <Package className="h-4 w-4" />;
      case 'assembly': return <Wrench className="h-4 w-4" />;
      case 'maintenance': return <Wrench className="h-4 w-4" />;
      case 'quality_check': return <CheckCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatDueDate = (dateString?: string) => {
    if (!dateString) return 'No due date';
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60));
    
    if (diffHours < 0) return 'Overdue';
    if (diffHours < 1) return 'Due now';
    if (diffHours < 24) return `Due in ${diffHours}h`;
    return `Due ${date.toLocaleDateString()}`;
  };

  const formatElapsedTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const handleDeleteTask = async () => {
    if (deleteTaskId) {
      await deleteTask(deleteTaskId);
      setDeleteTaskId(null);
    }
  };

  const handleClearCompletedTasks = async () => {
    try {
      const taskCount = completedTasks.length;

      // Delete all tasks in parallel using cloud API
      await Promise.all(
        completedTasks.map(task =>
          api.delete(`/api/v1/worklist/${task.id}`)
        )
      );

      // Show single success toast
      toast({
        title: "Success",
        description: `${taskCount} completed task${taskCount !== 1 ? 's' : ''} deleted successfully`,
      });

      // Fetch tasks once to update UI
      await refetch();
    } catch (error) {
      console.error('Error deleting completed tasks:', error);
      toast({
        title: "Error",
        description: "Failed to delete some tasks",
        variant: "destructive",
      });
    } finally {
      setIsClearCompletedModalOpen(false);
    }
  };

  // Handler to check inventory before completing assembly tasks
  const handleCompleteWithInventoryCheck = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);

    // Only check inventory for assembly tasks
    if (task?.task_type === 'assembly' && task?.assembly_task_id) {
      try {
        const inventoryCheck = await checkInventoryAvailability(task.assembly_task_id);

        if (inventoryCheck.hasShortage) {
          // Show confirmation modal
          setInventoryConfirmation({ taskId, shortages: inventoryCheck.shortages });
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
    await completeTask(taskId);
  };

  const handleConfirmInventoryShortage = async () => {
    if (inventoryConfirmation) {
      await completeTaskForced(inventoryConfirmation.taskId);
      setInventoryConfirmation(null);
    }
  };

  const TaskCard = ({ task }: { task: WorklistTask }) => (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {getTypeIcon(task.task_type)}
            <div>
              <CardTitle className="text-lg">{task.title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
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
          <div className="text-right text-sm text-muted-foreground">
            <div>{formatDueDate(task.due_date)}</div>
            <div>~{task.estimated_time_minutes || 'N/A'} min</div>
            {task.status === 'in_progress' && elapsedTimes[task.id] && (
              <div className="font-medium text-blue-600">
                Elapsed: {formatElapsedTime(elapsedTimes[task.id])}
              </div>
            )}
            {task.status === 'completed' && task.actual_time_minutes && (
              <div className="font-medium text-green-600">
                Completed in: {formatElapsedTime(task.actual_time_minutes)}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4">{task.description}</p>


        {task.status !== 'completed' && task.status !== 'cancelled' && (
          <div className="flex gap-2">
            {task.status === 'pending' && (
              <Button onClick={async () => {
                await startTask(task.id);
                navigate(`/worklist/${task.id}`);
              }} variant="outline">
                Start Task
              </Button>
            )}
            {task.status === 'in_progress' && (
              <>
                <Button onClick={() => navigate(`/worklist/${task.id}`)} variant="outline">
                  Open Task
                </Button>
                <Button onClick={() => cancelTask(task.id)} variant="outline">
                  Cancel
                </Button>
                <Button onClick={() => handleCompleteWithInventoryCheck(task.id)}>
                  Complete
                </Button>
              </>
            )}
            {task.status === 'pending' && (
              <Button onClick={() => handleCompleteWithInventoryCheck(task.id)} variant="secondary">
                Mark Complete
              </Button>
            )}
          </div>
        )}
        {task.status === 'completed' && (
          <div className="flex gap-2">
            <Button
              onClick={() => setDeleteTaskId(task.id)}
              variant="outline"
              size="sm"
              className="text-green-600 hover:text-green-700"
            >
              <Check className="mr-2 h-4 w-4" />
              Clear Completed Task
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress');
  const completedTasks = tasks.filter(task => task.status === 'completed');

  if (loading) {
    return <div>Loading worklist...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Worklist</h1>
        <p className="text-muted-foreground">Tasks and actions that require human intervention</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{pendingTasks.length}</p>
                <p className="text-sm text-muted-foreground">To Do Tasks</p>
              </div>
              <ClipboardList className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{inProgressTasks.length}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
              <Clock className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{completedTasks.length}</p>
                <p className="text-sm text-muted-foreground">Completed Today</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="pending">
              To Do ({pendingTasks.length})
            </TabsTrigger>
            <TabsTrigger value="in_progress">
              In Progress ({inProgressTasks.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed ({completedTasks.length})
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {completedTasks.length > 0 && (
              <Button variant="outline" onClick={() => setIsClearCompletedModalOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Completed Tasks
              </Button>
            )}
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Task
            </Button>
          </div>
        </div>

        <TabsContent value="pending" className="mt-6">
          {pendingTasks.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No tasks to do</p>
              </CardContent>
            </Card>
          ) : (
            pendingTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </TabsContent>

        <TabsContent value="in_progress" className="mt-6">
          {inProgressTasks.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No tasks in progress</p>
              </CardContent>
            </Card>
          ) : (
            inProgressTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {completedTasks.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No completed tasks today</p>
              </CardContent>
            </Card>
          ) : (
            completedTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </TabsContent>
      </Tabs>

      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onTaskCreated={createTask}
      />

      <AlertDialog open={deleteTaskId !== null} onOpenChange={(open) => !open && setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Completed Task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this completed task from the worklist. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTask}>
              Delete Task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isClearCompletedModalOpen} onOpenChange={setIsClearCompletedModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Completed Tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {completedTasks.length} completed task{completedTasks.length !== 1 ? 's' : ''} from the worklist. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCompletedTasks}>
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={inventoryConfirmation !== null} onOpenChange={(open) => !open && setInventoryConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Insufficient Inventory Detected
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>The following components have insufficient inventory:</p>
                <ul className="list-disc list-inside pl-2 space-y-1 text-sm">
                  {inventoryConfirmation?.shortages.map((shortage, i) => (
                    <li key={i}>
                      <strong>{shortage.componentName}:</strong> need {shortage.needed} units, only {shortage.available} available
                    </li>
                  ))}
                </ul>
                <div className="pt-2 border-t">
                  <p className="font-medium mb-1">Completing this task will:</p>
                  <ul className="list-disc list-inside pl-2 space-y-1 text-sm">
                    <li>Complete the assembly task</li>
                    <li>Set short components to 0 inventory</li>
                    <li>Consume other components normally</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmInventoryShortage}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              Complete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Worklist;