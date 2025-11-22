import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getPrinterModelLabel } from '@/services/metadataParser';

interface PrinterModel {
  code: string;
  label: string;
}

// All available printer models
const PRINTER_MODELS: PrinterModel[] = [
  { code: 'N1', label: 'A1 Mini' },
  { code: 'N2S', label: 'A1' },
  { code: 'P1P', label: 'P1P' },
  { code: 'P1S', label: 'P1S' },
  { code: 'X1', label: 'X1' },
  { code: 'X1C', label: 'X1 Carbon' },
  { code: 'X1E', label: 'X1 Enterprise' },
];

interface SortableItemProps {
  model: PrinterModel;
  index: number;
}

function SortableItem({ model, index }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: model.code });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border hover:bg-muted transition-colors"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-5 w-5" />
      </div>

      <div className="flex items-center justify-between flex-1">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono text-sm px-3 py-1">
            {index + 1}
          </Badge>
          <span className="font-medium">{model.label}</span>
        </div>
        <Badge className="bg-[#192A52] text-white hover:bg-[#1a2e56]">
          {model.code}
        </Badge>
      </div>
    </div>
  );
}

interface PrinterPriorityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentPriority: string[]; // Array of printer model codes in order
  onSave: (priority: string[]) => void;
}

export const PrinterPriorityDialog = ({
  isOpen,
  onClose,
  currentPriority,
  onSave,
}: PrinterPriorityDialogProps) => {
  const [orderedModels, setOrderedModels] = useState<PrinterModel[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize ordered models from currentPriority or use default order
  useEffect(() => {
    if (isOpen) {
      if (currentPriority && currentPriority.length > 0) {
        // Build ordered list from saved priority
        const ordered = currentPriority
          .map(code => PRINTER_MODELS.find(m => m.code === code))
          .filter(Boolean) as PrinterModel[];

        // Add any missing models at the end
        const existingCodes = new Set(currentPriority);
        const remaining = PRINTER_MODELS.filter(m => !existingCodes.has(m.code));

        setOrderedModels([...ordered, ...remaining]);
      } else {
        // Use default order
        setOrderedModels([...PRINTER_MODELS]);
      }
    }
  }, [isOpen, currentPriority]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setOrderedModels((models) => {
        const oldIndex = models.findIndex((m) => m.code === active.id);
        const newIndex = models.findIndex((m) => m.code === over.id);

        return arrayMove(models, oldIndex, newIndex);
      });
    }
  };

  const handleSave = () => {
    const priorityOrder = orderedModels.map(m => m.code);
    onSave(priorityOrder);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configure Printer Priority</DialogTitle>
          <DialogDescription>
            Drag and drop to reorder printer models by priority. This will be used for automatic print job routing.
            The highest priority printer will be selected first when routing jobs.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">
              Priority Order (highest to lowest):
            </p>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedModels.map(m => m.code)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {orderedModels.map((model, index) => (
                  <SortableItem key={model.code} model={model} index={index} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Priority
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
