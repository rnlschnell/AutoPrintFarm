import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus, User, Printer, Package, Wrench, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { WorklistTask } from "@/hooks/useWorklistTasks";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated: (task: Partial<WorklistTask>) => void;
}

const CreateTaskModal = ({ isOpen, onClose, onTaskCreated }: CreateTaskModalProps) => {
  const [taskData, setTaskData] = useState({
    title: '',
    description: '',
    task_type: '',
    priority: 'medium',
    assigned_to: '',
    estimated_time_minutes: '',
    due_date: undefined as Date | undefined,
    printer_id: '',
    order_number: ''
  });
  
  const { toast } = useToast();

  const taskTypes = [
    { value: 'assembly', label: 'Assembly', icon: Wrench },
    { value: 'filament_change', label: 'Filament Change', icon: Printer },
    { value: 'collection', label: 'Collection', icon: Package },
    { value: 'maintenance', label: 'Maintenance', icon: Wrench },
    { value: 'quality_check', label: 'Quality Check', icon: CheckCircle }
  ];

  const priorities = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }
  ];

  const handleCreateTask = () => {
    if (!taskData.title.trim() || !taskData.task_type) {
      toast({
        title: "Error",
        description: "Please fill in the title and task type.",
        variant: "destructive",
      });
      return;
    }

    const newTask: Partial<WorklistTask> = {
      title: taskData.title.trim(),
      description: taskData.description.trim() || undefined,
      task_type: taskData.task_type as WorklistTask['task_type'],
      priority: taskData.priority as WorklistTask['priority'],
      assigned_to: taskData.assigned_to || undefined,
      estimated_time_minutes: taskData.estimated_time_minutes ? parseInt(taskData.estimated_time_minutes) : undefined,
      due_date: taskData.due_date ? taskData.due_date.toISOString() : undefined,
      printer_id: taskData.printer_id || undefined,
      order_number: taskData.order_number.trim() || undefined,
    };

    onTaskCreated(newTask);
    
    // Reset form
    setTaskData({
      title: '',
      description: '',
      task_type: '',
      priority: 'medium',
      assigned_to: '',
      estimated_time_minutes: '',
      due_date: undefined,
      printer_id: '',
      order_number: ''
    });
    
    onClose();
  };

  const getTaskTypeIcon = (taskType: string) => {
    const type = taskTypes.find(t => t.value === taskType);
    if (!type) return Clock;
    return type.icon;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={taskData.title}
                onChange={(e) => setTaskData({ ...taskData, title: e.target.value })}
                placeholder="Enter task title"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="task_type">Task Type *</Label>
              <Select value={taskData.task_type} onValueChange={(value) => setTaskData({ ...taskData, task_type: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{type.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={taskData.priority} onValueChange={(value) => setTaskData({ ...taskData, priority: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimated_time">Estimated Time (minutes)</Label>
              <Input
                id="estimated_time"
                type="number"
                min="1"
                value={taskData.estimated_time_minutes}
                onChange={(e) => setTaskData({ ...taskData, estimated_time_minutes: e.target.value })}
                placeholder="e.g. 30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={taskData.description}
              onChange={(e) => setTaskData({ ...taskData, description: e.target.value })}
              placeholder="Task description (optional)"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !taskData.due_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {taskData.due_date ? format(taskData.due_date, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={taskData.due_date}
                    onSelect={(date) => setTaskData({ ...taskData, due_date: date })}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order_number">Order Number</Label>
              <Input
                id="order_number"
                value={taskData.order_number}
                onChange={(e) => setTaskData({ ...taskData, order_number: e.target.value })}
                placeholder="Order #123 (optional)"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreateTask}>
            <Plus className="mr-2 h-4 w-4" />
            Add Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskModal;