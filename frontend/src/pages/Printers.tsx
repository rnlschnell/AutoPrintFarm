import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MoreHorizontal, Clock, Palette, Plus, GripVertical, LayoutGrid, List, Package, Settings, Thermometer, Pencil, Square, Layers2, Check, ArrowRight, X, Wrench, Wifi, WifiOff } from "lucide-react";
import { useDashboardWebSocket, type DashboardPrinterStatus } from "@/hooks/useDashboardWebSocket";
import { useHubs } from "@/hooks/useHubs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import PrinterDetailsModal from "@/components/PrinterDetailsModal";
import PrinterMaintenanceModal from "@/components/PrinterMaintenanceModal";
import CompleteMaintenanceModal from "@/components/CompleteMaintenanceModal";
import CalibrationModal from "@/components/CalibrationModal";
import { FilamentLevelModal } from "@/components/FilamentLevelModal";
import ColorSwatch from "@/components/ColorSwatch";
import PrinterColorSelector from "@/components/PrinterColorSelector";
import PrinterBuildPlateSelector from "@/components/PrinterBuildPlateSelector";
import PrintControlButtons from "@/components/PrintControlButtons";
import { usePrinters, type Printer } from "@/hooks/usePrinters";
import { formatTime, formatLayerProgress } from "@/lib/utils";

// Global color settings - this would normally come from a global store or context
const globalColors = [
  'Galaxy Black|#1a1a1a',
  'Signal White|#ffffff',
  'Transparent Blue|#3b82f6',
  'Red|#ef4444',
  'Green|#22c55e',
  'Yellow|#eab308',
  'Orange|#f97316',
  'Purple|#a855f7'
];

const getStatusBadge = (status: string) => {
    switch (status) {
        case 'printing':
            return <Badge className="bg-blue-600 text-white hover:bg-blue-700">Printing</Badge>;
        case 'idle':
            return <Badge className="bg-green-600 text-white hover:bg-green-700">Idle</Badge>;
        case 'maintenance':
        case 'offline':
            return <Badge variant="destructive">{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
};

interface PrinterCardProps {
  printer: Printer;
  liveData?: DashboardPrinterStatus;
  isWebSocketConnected?: boolean;
  onViewDetails: (printer: Printer) => void;
  onStartMaintenance: (printer: Printer) => void;
  onCompleteMaintenance: (printer: Printer) => void;
  onStartCalibration: (printer: Printer) => void;
  onEditFilament: (printer: Printer) => void;
  onToggleCleared?: (printerId: string) => Promise<void>;
  updatePrinter: (id: string, updates: Partial<Printer>) => Promise<Printer>;
  isDragging?: boolean;
}

const PrinterCard = ({ printer, liveData, isWebSocketConnected, onViewDetails, onStartMaintenance, onCompleteMaintenance, onStartCalibration, onEditFilament, onToggleCleared, updatePrinter, isDragging = false }: PrinterCardProps) => {
  const [clearedClickCount, setClearedClickCount] = useState(0);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: printer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 'auto',
  };

  // Separate connection status from print job status
  // With the new WebSocket, we check if we have live data to determine connection
  const hasLiveData = !!liveData;
  const isConnected = hasLiveData || (printer.connected ?? false);
  const connectionStatus = isConnected ? 'connected' : 'offline';

  // Get print job status - what the printer is currently doing or last job state
  const printJobStatus = liveData ? liveData.status : (printer.status === 'offline' ? 'idle' : printer.status);
  
  // Get status color for the top border (based on connection, not job status)
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'offline':
        return 'bg-red-500';
      default:
        return 'bg-muted';
    }
  };

  // Get temperatures from live data or fallback to mock data
  const getTemperatures = () => {
    if (liveData?.temperatures) {
      return {
        hotend: Math.round(liveData.temperatures.nozzle ?? 0),
        hotendTarget: liveData.temperatures.nozzle ? Math.round(liveData.temperatures.nozzle) : undefined,
        bed: Math.round(liveData.temperatures.bed ?? 0),
        bedTarget: liveData.temperatures.bed ? Math.round(liveData.temperatures.bed) : undefined,
        chamber: liveData.temperatures.chamber ? Math.round(liveData.temperatures.chamber) : undefined
      };
    }

    // Fallback to mock data based on connection and print status
    if (!isConnected) {
      return { hotend: 0, bed: 0 };
    }

    switch (printJobStatus) {
      case 'printing':
        return { hotend: 215, bed: 60 };
      case 'idle':
        return { hotend: 25, bed: 25 };
      case 'maintenance':
        return { hotend: 180, bed: 0 };
      default:
        return { hotend: 25, bed: 25 }; // Connected but status unknown
    }
  };

  const temperatures = getTemperatures();

  // Direct computation - no memoization needed for simple string concatenation
  const printerColor = printer.currentColorHex && printer.currentColor
    ? `${printer.currentColor}|${printer.currentColorHex}`
    : null;

  // Get progress from live data only - no mock data
  const getProgress = () => {
    if (liveData?.progress_percentage !== undefined && printJobStatus === 'printing') {
      return liveData.progress_percentage;
    }

    return 0; // No progress when not printing or no live data available
  };

  const progress = getProgress();

  // Get layer info from live data
  const currentLayer = liveData?.current_layer;
  const totalLayers = liveData?.total_layers;
  const remainingTime = liveData?.remaining_time_seconds;
  
  // Get the display text for the progress area
  const getProgressText = () => {
    if (!isConnected) {
      return 'Offline';
    }

    switch (printJobStatus) {
      case 'printing':
        if (liveData?.progress_percentage !== undefined) {
          return `${progress}% complete`;
        } else {
          return 'Printing...'; // Show we're printing but don't have progress data yet
        }
      case 'failed':
        return 'Failed';
      case 'cancelled':
      case 'canceled': // Handle both spellings
        return 'Canceled';
      case 'idle':
        return 'Ready';
      case 'maintenance':
        return 'Maintenance';
      default:
        return 'Ready';
    }
  };

  const handleClearedBadgeClick = async () => {
    if (clearedClickCount === 0) {
      // First click: change text to "Printer Ready?"
      setClearedClickCount(1);
    } else if (clearedClickCount === 1) {
      // Second click: call API to set cleared=true and remove badge
      if (onToggleCleared && printer.printerId) {
        await onToggleCleared(printer.printerId.toString());
        setClearedClickCount(0); // Reset state
      }
    }
  };

  const getClearedBadgeText = () => {
    if (clearedClickCount === 0) {
      return "Needs to be cleared";
    } else {
      return "Printer Ready?";
    }
  };

  // Show cleared badge if printer.cleared is false/0 OR if user has clicked once
  // Using !printer.cleared handles both boolean false and integer 0 from SQLite
  const showClearedBadge = !printer.cleared || clearedClickCount === 1;

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={`flex flex-col overflow-hidden ${isDragging ? 'opacity-30' : ''} relative bg-gradient-to-br from-card to-card/50 border-0 shadow-lg hover:shadow-xl transition-all duration-300`}
    >
      {/* Header Bar */}
      <div className="h-12 flex items-center justify-between px-4" style={{ backgroundColor: '#192A52' }}>
        <div
          className="cursor-grab active:cursor-grabbing flex-shrink-0 touch-none p-1 -ml-1 rounded hover:bg-white/10 transition-colors"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-white" />
        </div>

        <h3
          className="font-semibold text-white text-center flex-1 truncate px-4 cursor-pointer hover:text-white/80 transition-colors"
          onClick={() => onViewDetails(printer)}
        >
          {printer.name}
        </h3>

        {/* WebSocket connection indicator */}
        <div className="flex items-center gap-2">
          {isWebSocketConnected !== undefined && (
            <div
              className={`p-1 rounded ${isWebSocketConnected ? 'text-green-400' : 'text-red-400'}`}
              title={isWebSocketConnected ? 'Live data connected' : 'Live data disconnected'}
            >
              {isWebSocketConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </div>
          )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-white/20 text-white">
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onViewDetails(printer)}>
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartMaintenance(printer)}>
              Start Maintenance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartCalibration(printer)}>
              Calibrate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-3">
        {/* Status and Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
              <span className="text-sm font-medium capitalize">
                {connectionStatus === 'connected' ? 'Connected' : 'Offline'}
              </span>
              {isConnected && (
                <PrintControlButtons
                  printerId={liveData?.printer_id || printer.printerId?.toString() || ''}
                  status={printJobStatus}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              {printer.inMaintenance && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-yellow-700 bg-yellow-100 hover:text-yellow-800 hover:bg-yellow-200 rounded-md dark:bg-yellow-900/40 dark:text-yellow-400 dark:hover:bg-yellow-900/60 dark:hover:text-yellow-300"
                  onClick={() => onCompleteMaintenance(printer)}
                >
                  <Wrench className="h-4 w-4" />
                  <span className="text-xs font-medium">Maintenance</span>
                </Button>
              )}
              {printJobStatus === 'printing' && (
                <div className="text-right space-y-1">
                  <div className="text-xs text-muted-foreground">{formatLayerProgress(currentLayer, totalLayers)}</div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Progress 
              value={printJobStatus === 'printing' ? progress : 0} 
              className="h-2" 
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{getProgressText()}</span>
              {printJobStatus === 'printing' && remainingTime !== undefined && (
                <span>{formatTime(remainingTime)} left</span>
              )}
            </div>
          </div>
        </div>

        {/* Temperature Display */}
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Hotend:</span>
              <span className="font-medium">{temperatures.hotend}°C</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Bed:</span>
              <span className="font-medium">{temperatures.bed}°C</span>
            </div>
          </div>
        </div>

        {/* Filament Information */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {printerColor ? (
              <>
                <ColorSwatch color={printerColor} size="sm" />
                <span className="text-sm font-medium">{printerColor.split('|')[0]}</span>
                <span className="text-sm text-muted-foreground">{printer.currentFilamentType || 'PLA'}</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No Filament Added</span>
            )}
            <PrinterColorSelector printer={printer} updatePrinter={updatePrinter} />
          </div>
          <div className="flex items-center gap-2">
            <Layers2 className="h-3 w-3 text-muted-foreground" />
            <PrinterBuildPlateSelector printer={printer} variant="inline" updatePrinter={updatePrinter} />
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{printer.filamentLevel || 0}g left</span>
              <button
                onClick={() => onEditFilament(printer)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Edit filament level"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            {/* Cleared Status Badge - Inline Right */}
            {showClearedBadge && (
              <div className="flex items-center gap-1">
                {clearedClickCount === 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setClearedClickCount(0);
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Undo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <Badge
                  variant="outline"
                  className={`cursor-pointer hover:bg-accent transition-colors flex items-center gap-1.5 ${
                    clearedClickCount === 0
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-500 text-yellow-700 dark:text-yellow-400'
                      : 'bg-green-100 dark:bg-green-900/30 border-green-500 text-green-700 dark:text-green-400'
                  }`}
                  onClick={handleClearedBadgeClick}
                >
                  <span className="text-xs">{getClearedBadgeText()}</span>
                  {clearedClickCount === 0 ? (
                    <ArrowRight className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

interface PrinterRowProps {
  printer: Printer;
  liveData?: DashboardPrinterStatus;
  isWebSocketConnected?: boolean;
  onViewDetails: (printer: Printer) => void;
  onStartMaintenance: (printer: Printer) => void;
  onStartCalibration: (printer: Printer) => void;
  updatePrinter: (id: string, updates: Partial<Printer>) => Promise<Printer>;
}

const PrinterRow = ({ printer, liveData, isWebSocketConnected, onViewDetails, onStartMaintenance, onStartCalibration, updatePrinter }: PrinterRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: printer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Separate connection status from print job status (same logic as card view)
  const hasLiveData = !!liveData;
  const isConnected = hasLiveData || (printer.connected ?? false);
  const connectionStatus = isConnected ? 'connected' : 'offline';
  const printJobStatus = liveData ? liveData.status : (printer.status === 'offline' ? 'idle' : printer.status);
  const remainingTime = liveData?.remaining_time_seconds;

  // Direct computation - no memoization needed for simple string concatenation
  const printerColor = printer.currentColorHex && printer.currentColor
    ? `${printer.currentColor}|${printer.currentColorHex}`
    : null;

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell>
        <div className="flex items-center gap-2">
          <div
            className="cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-gray-400" />
          </div>
          <div>
            <div className="font-medium">{printer.name}</div>
            <div className="text-sm text-muted-foreground">{printer.model}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>{getStatusBadge(connectionStatus === 'connected' ? 'Connected' : 'Offline')}</TableCell>
      <TableCell className="truncate max-w-32">{printJobStatus === 'printing' ? 'Printing...' : 'N/A'}</TableCell>
      <TableCell>{printJobStatus === 'printing' && remainingTime !== undefined ? formatTime(remainingTime) : 'N/A'}</TableCell>
      <TableCell>
        {printerColor ? (
          <div className="flex items-center gap-2">
            <ColorSwatch color={printerColor} size="sm" />
            <span className="truncate">{printerColor.split('|')[0]}</span>
            <span className="text-sm text-muted-foreground">{printer.currentFilamentType || 'PLA'}</span>
            <PrinterColorSelector printer={printer} updatePrinter={updatePrinter} />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No Filament Added</span>
        )}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="sm" variant="outline">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onViewDetails(printer)}>
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartMaintenance(printer)}>
              Start Maintenance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartCalibration(printer)}>
              Calibrate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const Printers = () => {
  const { printers, loading, addPrinter, updatePrinter, updatePrintersOrder, toggleCleared, refetch } = usePrinters();
  const { printerStatuses, isConnected: isWebSocketConnected, isReconnecting } = useDashboardWebSocket();
  const { hubs, loading: hubsLoading } = useHubs();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [isCompleteMaintenanceModalOpen, setIsCompleteMaintenanceModalOpen] = useState(false);
  const [isCalibrationModalOpen, setIsCalibrationModalOpen] = useState(false);
  const [isFilamentModalOpen, setIsFilamentModalOpen] = useState(false);
  const [selectedFilamentPrinter, setSelectedFilamentPrinter] = useState<Printer | null>(null);
  const [activeId, setActiveId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [newPrinter, setNewPrinter] = useState({
    name: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    ipAddress: '',
    accessCode: '',
    hubId: ''
  });
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    setActiveId(null);

    if (active.id !== over?.id) {
      const oldIndex = printers.findIndex(printer => printer.id === active.id);
      const newIndex = printers.findIndex(printer => printer.id === over.id);
      
      const newOrder = arrayMove(printers, oldIndex, newIndex);
      
      try {
        await updatePrintersOrder(newOrder);
        toast({
          title: "Printer Order Updated",
          description: "The printer order has been saved.",
        });
      } catch (error) {
        // Error toast is handled in the hook
      }
    }
  };

  const handleAddPrinter = async () => {
    if (!newPrinter.name || !newPrinter.manufacturer || !newPrinter.model) {
      toast({
        title: "Error",
        description: "Please fill in the required fields.",
        variant: "destructive",
      });
      return;
    }

    try {
      await addPrinter({
        ...newPrinter,
        status: 'offline' as const
      });
      setNewPrinter({
        name: '',
        manufacturer: '',
        model: '',
        serialNumber: '',
        ipAddress: '',
        accessCode: '',
        hubId: ''
      });
      setIsAddModalOpen(false);
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  const handleViewDetails = (printer: Printer) => {
    setSelectedPrinter(printer);
    setIsDetailsModalOpen(true);
  };

  const handleStartMaintenance = (printer: Printer) => {
    setSelectedPrinter(printer);
    setIsMaintenanceModalOpen(true);
  };

  const handleCompleteMaintenance = (printer: Printer) => {
    setSelectedPrinter(printer);
    setIsCompleteMaintenanceModalOpen(true);
  };

  const handleStartCalibration = (printer: Printer) => {
    setSelectedPrinter(printer);
    setIsCalibrationModalOpen(true);
  };

  const handleEditFilament = (printer: Printer) => {
    setSelectedFilamentPrinter(printer);
    setIsFilamentModalOpen(true);
  };

  const handleUpdateFilament = async (printerId: string, filamentLevel: number) => {
    try {
      await updatePrinter(printerId, { filamentLevel });
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  const activePrinter = printers.find(printer => printer.id === activeId);

  // Helper function to get live data for a specific printer
  // The printerStatuses map uses printer_id as the key
  const getLiveDataForPrinter = (printerIntegerId: number | undefined): DashboardPrinterStatus | undefined => {
    if (!printerIntegerId) return undefined;
    return printerStatuses.get(printerIntegerId.toString());
  };

  // Filter printers based on status
  const filteredPrinters = statusFilter === 'all'
    ? printers
    : printers.filter(printer => {
        // Get live data for this printer to check current status
        const printerLiveData = getLiveDataForPrinter(printer.printerId);
        const hasLiveData = !!printerLiveData;
        const printerIsConnected = hasLiveData || (printer.connected ?? false);
        const printerJobStatus = printerLiveData ? printerLiveData.status : (printer.status === 'offline' ? 'idle' : printer.status);
        
        switch (statusFilter) {
          case 'printing':
            return printerJobStatus === 'printing';
          case 'idle':
            return printerIsConnected && (printerJobStatus === 'idle' || printerJobStatus === 'ready');
          case 'failed':
            // Show printers with failed print jobs OR disconnected printers
            return printerJobStatus === 'failed' || printerJobStatus === 'cancelled' || printerJobStatus === 'canceled' || !printerIsConnected;
          case 'needs-attention':
            return printerJobStatus === 'maintenance';
          default:
            return true;
        }
      });

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading printers...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Printer Fleet</h1>
          <p className="text-muted-foreground">Manage your connected 3D printers.</p>
        </div>
        <div className="flex items-center gap-4">
          <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value)}>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Printer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Printer</DialogTitle>
                <DialogDescription>
                  Add a new 3D printer to your fleet.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name *
                  </Label>
                  <Input
                    id="name"
                    value={newPrinter.name}
                    onChange={(e) => setNewPrinter({ ...newPrinter, name: e.target.value })}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="manufacturer" className="text-right">
                    Manufacturer *
                  </Label>
                  <Select
                    value={newPrinter.manufacturer}
                    onValueChange={(value) => setNewPrinter({ ...newPrinter, manufacturer: value })}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select manufacturer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Bambu Labs">Bambu Labs</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="model" className="text-right">
                    Model *
                  </Label>
                  <Select
                    value={newPrinter.model}
                    onValueChange={(value) => setNewPrinter({ ...newPrinter, model: value })}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A1 Mini">A1 Mini</SelectItem>
                      <SelectItem value="A1">A1</SelectItem>
                      <SelectItem value="P1P">P1P</SelectItem>
                      <SelectItem value="P1S">P1S</SelectItem>
                      <SelectItem value="X1C">X1C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="serial_number" className="text-right">
                    Serial Number
                  </Label>
                  <Input
                    id="serial_number"
                    value={newPrinter.serialNumber}
                    onChange={(e) => setNewPrinter({ ...newPrinter, serialNumber: e.target.value })}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="ip_address" className="text-right">
                    IP Address
                  </Label>
                  <Input
                    id="ip_address"
                    value={newPrinter.ipAddress}
                    onChange={(e) => setNewPrinter({ ...newPrinter, ipAddress: e.target.value })}
                    className="col-span-3"
                    placeholder="192.168.1.100"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="access_code" className="text-right">
                    Access Code
                  </Label>
                  <Input
                    id="access_code"
                    value={newPrinter.accessCode}
                    onChange={(e) => setNewPrinter({ ...newPrinter, accessCode: e.target.value })}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="hub" className="text-right">
                    Hub
                  </Label>
                  <Select
                    value={newPrinter.hubId}
                    onValueChange={(value) => setNewPrinter({ ...newPrinter, hubId: value })}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder={hubsLoading ? "Loading hubs..." : "Select hub (optional)"} />
                    </SelectTrigger>
                    <SelectContent>
                      {hubs.map((hub) => (
                        <SelectItem key={hub.id} value={hub.id}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${hub.liveStatus?.is_online ? 'bg-green-500' : 'bg-red-500'}`} />
                            {hub.name || hub.id}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" onClick={handleAddPrinter}>
                  Add Printer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mb-4">
        <ToggleGroup 
          type="single" 
          value={statusFilter} 
          onValueChange={(value) => value && setStatusFilter(value)} 
          className="justify-start"
        >
          <ToggleGroupItem value="all" aria-label="All Printers" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            All Printers
          </ToggleGroupItem>
          <ToggleGroupItem value="printing" aria-label="Printing" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            Printing
          </ToggleGroupItem>
          <ToggleGroupItem value="idle" aria-label="Idle" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            Idle
          </ToggleGroupItem>
          <ToggleGroupItem value="failed" aria-label="Failed" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            Failed
          </ToggleGroupItem>
          <ToggleGroupItem value="needs-attention" aria-label="Needs Attention" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            Needs Attention
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {filteredPrinters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
            <Package className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No printers found</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            {statusFilter === 'all' 
              ? "You haven't added any printers to your fleet yet. Add your first printer to get started."
              : `No printers match the "${statusFilter}" filter. Try selecting a different filter or add a new printer.`
            }
          </p>
          {statusFilter === 'all' || printers.length === 0 ? (
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Printer
            </Button>
          ) : (
            <Button onClick={() => setStatusFilter('all')}>
              See All Printers
            </Button>
          )}
        </div>
      ) : (
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={filteredPrinters} strategy={verticalListSortingStrategy}>
          {viewMode === 'grid' ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPrinters.map((printer) => (
                <PrinterCard
                  key={printer.id}
                  printer={printer}
                  liveData={getLiveDataForPrinter(printer.printerId)}
                  isWebSocketConnected={isWebSocketConnected}
                  onViewDetails={handleViewDetails}
                  onStartMaintenance={handleStartMaintenance}
                  onCompleteMaintenance={handleCompleteMaintenance}
                  onStartCalibration={handleStartCalibration}
                  onEditFilament={handleEditFilament}
                  onToggleCleared={toggleCleared}
                  updatePrinter={updatePrinter}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Printer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current Job</TableHead>
                    <TableHead>Time Left</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrinters.map((printer) => (
                    <PrinterRow
                      key={printer.id}
                      printer={printer}
                      liveData={getLiveDataForPrinter(printer.printerId)}
                      isWebSocketConnected={isWebSocketConnected}
                      onViewDetails={handleViewDetails}
                      onStartMaintenance={handleStartMaintenance}
                      onStartCalibration={handleStartCalibration}
                      updatePrinter={updatePrinter}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SortableContext>
        <DragOverlay>
          {activeId && activePrinter ? (
            viewMode === 'grid' ? (
              <PrinterCard
                printer={activePrinter}
                isWebSocketConnected={isWebSocketConnected}
                onViewDetails={handleViewDetails}
                onStartMaintenance={handleStartMaintenance}
                onCompleteMaintenance={handleCompleteMaintenance}
                onStartCalibration={handleStartCalibration}
                onEditFilament={handleEditFilament}
                updatePrinter={updatePrinter}
                isDragging={false}
              />
            ) : (
              <div className="bg-background border rounded-md p-4 shadow-lg">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <div>
                    <div className="font-medium">{activePrinter.name}</div>
                    <div className="text-sm text-muted-foreground">{activePrinter.model}</div>
                  </div>
                </div>
              </div>
            )
          ) : null}
        </DragOverlay>
      </DndContext>
      )}

      <PrinterDetailsModal
        printer={selectedPrinter ? printers.find(p => p.id === selectedPrinter.id) || selectedPrinter : null}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
      />

      <PrinterMaintenanceModal
        printer={selectedPrinter}
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        onMaintenanceStarted={refetch}
      />

      <CompleteMaintenanceModal
        printer={selectedPrinter}
        isOpen={isCompleteMaintenanceModalOpen}
        onClose={() => setIsCompleteMaintenanceModalOpen(false)}
        onMaintenanceCompleted={refetch}
      />

      <CalibrationModal
        printer={selectedPrinter}
        isOpen={isCalibrationModalOpen}
        onClose={() => setIsCalibrationModalOpen(false)}
      />

      {selectedFilamentPrinter && (
        <FilamentLevelModal
          open={isFilamentModalOpen}
          onClose={() => setIsFilamentModalOpen(false)}
          printer={selectedFilamentPrinter}
          onUpdateFilament={handleUpdateFilament}
        />
      )}
    </div>
  );
};

export default Printers;
