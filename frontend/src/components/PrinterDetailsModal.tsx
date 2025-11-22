
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer as PrinterIcon, Square, Zap, Clock, Activity, Edit, Lightbulb, Home, PencilIcon, Check, X, Trash2, Camera, ArrowDownToLine, ArrowUpFromLine, Layers, ArrowRight, Loader2 } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";
import PrinterColorSelector from "@/components/PrinterColorSelector";
import PrinterBuildPlateSelector from "@/components/PrinterBuildPlateSelector";
import CameraViewModal from "@/components/CameraViewModal";
import PrintControlButtons from "@/components/PrintControlButtons";
import { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePrinters, type Printer } from "@/hooks/usePrinters";
import { usePrinterWebSocket, type LivePrinterData } from "@/hooks/useWebSocket";
import { formatTime, formatLayerProgress } from "@/lib/utils";

interface PrinterDetailsModalProps {
  printer: Printer | null;
  isOpen: boolean;
  onClose: () => void;
}

const PrinterDetailsModal = ({ printer, isOpen, onClose }: PrinterDetailsModalProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedModel, setEditedModel] = useState("");
  const [editedIpAddress, setEditedIpAddress] = useState("");
  const [editedSerialNumber, setEditedSerialNumber] = useState("");
  const [editedAccessCode, setEditedAccessCode] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLightToggling, setIsLightToggling] = useState(false);
  const [isHoming, setIsHoming] = useState(false);
  const [editingNozzleTemp, setEditingNozzleTemp] = useState(false);
  const [editingBedTemp, setEditingBedTemp] = useState(false);
  const [nozzleTempInput, setNozzleTempInput] = useState("");
  const [bedTempInput, setBedTempInput] = useState("");
  const [isSettingNozzleTemp, setIsSettingNozzleTemp] = useState(false);
  const [isSettingBedTemp, setIsSettingBedTemp] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isLoadingFilament, setIsLoadingFilament] = useState(false);
  const [isUnloadingFilament, setIsUnloadingFilament] = useState(false);
  const [isNozzleSelectorOpen, setIsNozzleSelectorOpen] = useState(false);
  const [clearedClickCount, setClearedClickCount] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { toast } = useToast();
  const { updatePrinter, deletePrinter, printers, toggleCleared } = usePrinters();
  const { data: liveData } = usePrinterWebSocket();

  // Always use the latest printer data from the printers array
  const currentPrinter = useMemo(() => {
    const latestPrinter = printers.find(p => p.id === printer?.id);
    return latestPrinter || printer;
  }, [printers, printer?.id, printer]);

  // Get live data for current printer
  const printerLiveData = useMemo(() => {
    return liveData?.find(data => data.printer_id === currentPrinter?.printerId?.toString());
  }, [liveData, currentPrinter?.printerId]);

  if (!currentPrinter) return null;

  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'printing': return 'default';
      case 'idle': return 'secondary';
      case 'maintenance':
      case 'offline': return 'destructive';
      default: return 'outline';
    }
  };

  const handleEdit = () => {
    setEditedName(currentPrinter.name);
    setEditedModel(currentPrinter.model);
    setEditedIpAddress(currentPrinter.ipAddress || "");
    setEditedSerialNumber(currentPrinter.serialNumber || "");
    setEditedAccessCode(currentPrinter.accessCode || "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      await updatePrinter(currentPrinter.id, {
        name: editedName,
        model: editedModel,
        ipAddress: editedIpAddress,
        serialNumber: editedSerialNumber,
        accessCode: editedAccessCode
      });
      setIsEditing(false);
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedName("");
    setEditedModel("");
    setEditedIpAddress("");
    setEditedSerialNumber("");
    setEditedAccessCode("");
  };

  const handleDelete = async () => {
    if (!currentPrinter?.id || isDeleting) return;

    setIsDeleting(true);
    try {
      await deletePrinter(currentPrinter.id);
      toast({
        title: "Printer Deleted",
        description: `${currentPrinter.name} has been removed from your fleet.`,
      });
      // Close modal after successful deletion
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete printer. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLightToggle = async () => {
    if (!currentPrinter?.id || isLightToggling) return;

    setIsLightToggling(true);
    try {
      // Use separate on/off endpoints instead of toggle
      const endpoint = isLightOn ? 'off' : 'on';
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/light/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to turn light ${endpoint}`);
      }
    } catch (error) {
      console.error('Error controlling light:', error);
      toast({
        title: "Error",
        description: "Failed to control printer light",
        variant: "destructive",
      });
    } finally {
      setIsLightToggling(false);
    }
  };

  const handleHome = async () => {
    if (!currentPrinter?.id || isHoming) return;

    setIsHoming(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/home`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to home printer');
      }

      const result = await response.json();
      
      toast({
        title: "Home Command",
        description: result.message || "Printer homing completed successfully",
      });
    } catch (error) {
      console.error('Error homing printer:', error);
      toast({
        title: "Error",
        description: "Failed to home printer",
        variant: "destructive",
      });
    } finally {
      setIsHoming(false);
    }
  };

  const handleSetNozzleTemp = async () => {
    if (!currentPrinter?.id || !nozzleTempInput || isSettingNozzleTemp) return;

    const temperature = parseInt(nozzleTempInput);
    if (isNaN(temperature) || temperature < 0 || temperature > 300) {
      toast({
        title: "Invalid Temperature",
        description: "Please enter a valid temperature between 0-300°C",
        variant: "destructive",
      });
      return;
    }

    setIsSettingNozzleTemp(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/temp/nozzle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ temperature, wait: false }),
      });

      if (!response.ok) {
        throw new Error('Failed to set nozzle temperature');
      }

      const result = await response.json();
      
      toast({
        title: "Temperature Set",
        description: `Nozzle temperature set to ${temperature}°C`,
      });

      setEditingNozzleTemp(false);
      setNozzleTempInput("");
    } catch (error) {
      console.error('Error setting nozzle temperature:', error);
      toast({
        title: "Error",
        description: "Failed to set nozzle temperature",
        variant: "destructive",
      });
    } finally {
      setIsSettingNozzleTemp(false);
    }
  };

  const handleSetBedTemp = async () => {
    if (!currentPrinter?.id || !bedTempInput || isSettingBedTemp) return;

    const temperature = parseInt(bedTempInput);
    if (isNaN(temperature) || temperature < 0 || temperature > 120) {
      toast({
        title: "Invalid Temperature",
        description: "Please enter a valid temperature between 0-120°C",
        variant: "destructive",
      });
      return;
    }

    setIsSettingBedTemp(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/temp/bed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ temperature, wait: false }),
      });

      if (!response.ok) {
        throw new Error('Failed to set bed temperature');
      }

      const result = await response.json();

      toast({
        title: "Temperature Set",
        description: `Bed temperature set to ${temperature}°C`,
      });

      setEditingBedTemp(false);
      setBedTempInput("");
    } catch (error) {
      console.error('Error setting bed temperature:', error);
      toast({
        title: "Error",
        description: "Failed to set bed temperature",
        variant: "destructive",
      });
    } finally {
      setIsSettingBedTemp(false);
    }
  };

  const handleLoadFilament = async () => {
    if (!currentPrinter?.id || isLoadingFilament) return;

    setIsLoadingFilament(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/filament/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ams_slot: 0 }),
      });

      if (!response.ok) {
        throw new Error('Failed to load filament');
      }

      const result = await response.json();

      toast({
        title: "Load Filament",
        description: result.message || "Filament load started successfully",
      });
    } catch (error) {
      console.error('Error loading filament:', error);
      toast({
        title: "Error",
        description: "Failed to load filament",
        variant: "destructive",
      });
    } finally {
      setIsLoadingFilament(false);
    }
  };

  const handleUnloadFilament = async () => {
    if (!currentPrinter?.id || isUnloadingFilament) return;

    setIsUnloadingFilament(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/filament/unload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ams_slot: 0 }),
      });

      if (!response.ok) {
        throw new Error('Failed to unload filament');
      }

      const result = await response.json();

      toast({
        title: "Unload Filament",
        description: result.message || "Filament unload started successfully",
      });
    } catch (error) {
      console.error('Error unloading filament:', error);
      toast({
        title: "Error",
        description: "Failed to unload filament",
        variant: "destructive",
      });
    } finally {
      setIsUnloadingFilament(false);
    }
  };

  const handleNozzleSizeChange = async (nozzleSize: number) => {
    if (!currentPrinter?.id) return;

    try {
      await updatePrinter(currentPrinter.id, {
        nozzleSize: nozzleSize
      });
      setIsNozzleSelectorOpen(false);
      toast({
        title: "Nozzle Size Updated",
        description: `Nozzle size set to ${nozzleSize}mm`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update nozzle size",
        variant: "destructive",
      });
    }
  };

  const handleReconnect = async () => {
    if (!currentPrinter?.printerId) return;

    setIsReconnecting(true);
    try {
      const response = await fetch(`/api/printers/${currentPrinter.printerId}/reconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to reconnect');
      }

      const result = await response.json();

      toast({
        title: "Reconnecting",
        description: result.message || "Attempting to reconnect to printer",
      });
    } catch (error) {
      console.error('Error reconnecting to printer:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reconnect to printer",
        variant: "destructive",
      });
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleClearedBadgeClick = async () => {
    if (!currentPrinter?.printerId) return;

    if (clearedClickCount === 0) {
      // First click: change text to "Printer Ready?"
      setClearedClickCount(1);
    } else if (clearedClickCount === 1) {
      // Second click: call API to set cleared=true and remove badge
      try {
        await toggleCleared(currentPrinter.printerId.toString());
        setClearedClickCount(0); // Reset state
        toast({
          title: "Printer Cleared",
          description: "Printer marked as ready for printing",
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to update cleared status",
          variant: "destructive",
        });
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
  // Using !currentPrinter?.cleared handles both boolean false and integer 0 from SQLite
  const showClearedBadge = !currentPrinter?.cleared || clearedClickCount === 1;

  // Get current status: if we have live data, printer is connected, otherwise offline
  const currentStatus = printerLiveData ? printerLiveData.status : 'offline';
  const isLightOn = printerLiveData?.light_on || false;
  
  const getCurrentTemperatures = () => {
    if (printerLiveData?.temperatures) {
      return {
        nozzle: Math.round(printerLiveData.temperatures.nozzle.current),
        bed: Math.round(printerLiveData.temperatures.bed.current)
      };
    }
    return { nozzle: 210, bed: 60 }; // fallback values
  };

  const temperatures = getCurrentTemperatures();

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          className="sm:max-w-[600px]"
          onClick={() => setIsNozzleSelectorOpen(false)}
        >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PrinterIcon className="h-5 w-5" />
            {isEditing ? "Edit Printer" : `${currentPrinter.name} Details`}
            {!isEditing && (
              <Badge className="!bg-[#00AE42] !text-white !border-0 ml-2">
                {currentPrinter.model}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {isEditing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Name *</Label>
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    placeholder="Printer name"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Model *</Label>
                  <Input
                    value={editedModel}
                    onChange={(e) => setEditedModel(e.target.value)}
                    placeholder="Printer model"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Serial Number</Label>
                  <Input
                    value={editedSerialNumber}
                    onChange={(e) => setEditedSerialNumber(e.target.value)}
                    placeholder="Serial number"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">IP Address</Label>
                  <Input
                    value={editedIpAddress}
                    onChange={(e) => setEditedIpAddress(e.target.value)}
                    placeholder="192.168.1.100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Access Code</Label>
                  <Input
                    value={editedAccessCode}
                    onChange={(e) => setEditedAccessCode(e.target.value)}
                    placeholder="8-digit access code"
                  />
                </div>
                <div className="space-y-2">
                  {/* Empty div for spacing */}
                </div>
              </div>
            </div>
          )}

          {!isEditing && (
            <>
              <div className="mt-2 space-y-4">
                {/* Current Status Section */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium">Current Status:</h3>
                    <Badge variant={getBadgeVariant(currentStatus)}>{currentStatus}</Badge>
                    {currentPrinter.isConnected && (
                      <PrintControlButtons
                        printerId={currentPrinter.printerId?.toString() || currentPrinter.id?.toString() || ''}
                        status={currentStatus}
                      />
                    )}
                  </div>

                  {/* Cleared Status Badge - Inline Right */}
                  {showClearedBadge && (
                    <div className="flex items-center gap-1">
                      {clearedClickCount === 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setClearedClickCount(0);
                          }}
                          aria-label="Undo"
                        >
                          <X className="h-3 w-3" />
                        </Button>
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

                {/* Filament, Build Plate, and Nozzle Size - Horizontal Layout */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Filament/Color */}
                  <div className="flex flex-col gap-2 p-3 border rounded-md">
                    <span className="text-xs text-muted-foreground font-medium">Filament</span>
                    <div className="flex items-center gap-2">
                      <ColorSwatch
                        color={currentPrinter.currentColorHex && currentPrinter.currentColor
                          ? `${currentPrinter.currentColor}|${currentPrinter.currentColorHex}`
                          : 'Black|#000000'}
                        size="sm"
                      />
                      <div className="flex flex-col flex-1">
                        <span className="text-sm">{currentPrinter.currentColor ? currentPrinter.currentColor.split('|')[0] : 'None'}</span>
                        <span className="text-xs text-muted-foreground">{currentPrinter.currentFilamentType || 'PLA'}</span>
                      </div>
                      <PrinterColorSelector printer={currentPrinter} />
                    </div>
                  </div>

                  {/* Build Plate */}
                  <div className="flex flex-col gap-2 p-3 border rounded-md">
                    <span className="text-xs text-muted-foreground font-medium">Build Plate</span>
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <div className="flex flex-col flex-1">
                        <span className="text-sm">{currentPrinter.currentBuildPlate || 'Not set'}</span>
                      </div>
                      <PrinterBuildPlateSelector printer={currentPrinter} />
                    </div>
                  </div>

                  {/* Nozzle Size */}
                  <div className="flex flex-col gap-2 p-3 border rounded-md">
                    <span className="text-xs text-muted-foreground font-medium">Nozzle Size</span>
                    <div className="flex items-center justify-center">
                      {!isNozzleSelectorOpen ? (
                        <span
                          className="text-sm cursor-pointer hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsNozzleSelectorOpen(true);
                          }}
                        >
                          {currentPrinter.nozzleSize || 0.4} mm
                        </span>
                      ) : (
                        <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                          {[0.2, 0.4, 0.6, 0.8].map((size) => (
                            <Button
                              key={size}
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleNozzleSizeChange(size)}
                            >
                              {size}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {currentStatus === 'printing' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">File:</span>
                        <span className="text-sm font-medium">{printerLiveData?.current_job?.filename || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Time Remaining:</span>
                        <span className="text-sm font-medium">{formatTime(printerLiveData?.progress?.remaining_time)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Layers:</span>
                        <span className="text-sm font-medium">{formatLayerProgress(printerLiveData?.progress?.current_layer, printerLiveData?.progress?.total_layers)}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Progress</span>
                        <span>{printerLiveData?.progress?.percentage || 0}%</span>
                      </div>
                      <Progress value={printerLiveData?.progress?.percentage || 0} className="h-2" />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No active print job
                  </div>
                )}
              </div>
              <Separator />
            </>
          )}

          {!isEditing && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Temperature Status</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-red-500" />
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Nozzle</p>
                        {editingNozzleTemp ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={nozzleTempInput}
                              onChange={(e) => setNozzleTempInput(e.target.value)}
                              placeholder={temperatures.nozzle.toString()}
                              className="h-8 w-20 text-sm"
                              min="0"
                              max="300"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSetNozzleTemp();
                                if (e.key === 'Escape') {
                                  setEditingNozzleTemp(false);
                                  setNozzleTempInput("");
                                }
                              }}
                              autoFocus
                            />
                            <span className="text-sm">°C</span>
                          </div>
                        ) : (
                          <p className="text-lg font-medium">{temperatures.nozzle}°C</p>
                        )}
                      </div>
                      {editingNozzleTemp ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleSetNozzleTemp}
                            disabled={isSettingNozzleTemp || !nozzleTempInput}
                            title="Confirm temperature"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingNozzleTemp(false);
                              setNozzleTempInput("");
                            }}
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingNozzleTemp(true);
                            setNozzleTempInput(temperatures.nozzle.toString());
                          }}
                          title="Edit nozzle temperature"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Square className="h-4 w-4 text-blue-500" />
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Bed</p>
                        {editingBedTemp ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={bedTempInput}
                              onChange={(e) => setBedTempInput(e.target.value)}
                              placeholder={temperatures.bed.toString()}
                              className="h-8 w-20 text-sm"
                              min="0"
                              max="120"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSetBedTemp();
                                if (e.key === 'Escape') {
                                  setEditingBedTemp(false);
                                  setBedTempInput("");
                                }
                              }}
                              autoFocus
                            />
                            <span className="text-sm">°C</span>
                          </div>
                        ) : (
                          <p className="text-lg font-medium">{temperatures.bed}°C</p>
                        )}
                      </div>
                      {editingBedTemp ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleSetBedTemp}
                            disabled={isSettingBedTemp || !bedTempInput}
                            title="Confirm temperature"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingBedTemp(false);
                              setBedTempInput("");
                            }}
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingBedTemp(true);
                            setBedTempInput(temperatures.bed.toString());
                          }}
                          title="Edit bed temperature"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-8">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadFilament}
                        disabled={isLoadingFilament}
                        title={isLoadingFilament ? "Loading filament..." : "Load filament"}
                      >
                        <ArrowDownToLine className="h-4 w-4 mr-1 text-green-600" />
                        Load Filament
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUnloadFilament}
                        disabled={isUnloadingFilament}
                        title={isUnloadingFilament ? "Unloading filament..." : "Unload filament"}
                      >
                        <ArrowUpFromLine className="h-4 w-4 mr-1 text-green-600" />
                        Unload Filament
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleHome}
                        disabled={isHoming}
                        title={isHoming ? "Homing..." : "Home printer"}
                      >
                        <Home className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className={`h-8 w-8 ${isLightOn ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' : ''}`}
                        onClick={handleLightToggle}
                        disabled={isLightToggling}
                        title={`Light is ${isLightOn ? 'ON' : 'OFF'} - Click to toggle`}
                      >
                        <Lightbulb className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium">System Info</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Connection:</span>
                    <div className="flex items-center gap-2">
                      <span className={currentPrinter.connected ? "text-green-600" : "text-red-600"}>
                        {currentPrinter.connected ? "Connected" : "Disconnected"}
                      </span>
                      {!currentPrinter.connected && (
                        <Button
                          onClick={handleReconnect}
                          disabled={isReconnecting}
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                        >
                          {isReconnecting ? "Reconnecting..." : "Reconnect"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Added:</span>
                    <span>
                      {currentPrinter.createdAt
                        ? new Date(currentPrinter.createdAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-between">
            {isEditing ? (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isDeleting}>
                      {isDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Printer
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Printer</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{currentPrinter.name}"? This action cannot be undone and will remove the printer from your fleet.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700" disabled={isDeleting}>
                        {isDeleting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          'Delete Printer'
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                  <Button onClick={handleSave}>Save Changes</Button>
                </div>
              </>
            ) : (
              <>
                <div></div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>Close</Button>
                  <Button variant="outline" onClick={handleEdit}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button onClick={() => setIsCameraModalOpen(true)}>
                    <Camera className="h-4 w-4 mr-2" />
                    See Live View
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <CameraViewModal
      printerId={currentPrinter.printerId?.toString() || null}
      printerName={currentPrinter.name}
      isOpen={isCameraModalOpen}
      onClose={() => setIsCameraModalOpen(false)}
    />
    </>
  );
};

export default PrinterDetailsModal;
