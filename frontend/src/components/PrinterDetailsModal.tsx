
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer as PrinterIcon, Square, Zap, Clock, Activity, Edit, Lightbulb } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";
import PrinterColorSelector from "@/components/PrinterColorSelector";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePrinters, type Printer } from "@/hooks/usePrinters";

interface PrinterDetailsModalProps {
  printer: Printer | null;
  isOpen: boolean;
  onClose: () => void;
}

const PrinterDetailsModal = ({ printer, isOpen, onClose }: PrinterDetailsModalProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedModel, setEditedModel] = useState("");
  const [nozzleTemp, setNozzleTemp] = useState("210");
  const [bedTemp, setBedTemp] = useState("60");
  const { toast } = useToast();
  const { updatePrinter, printers } = usePrinters();

  // Always use the latest printer data from the printers array
  const currentPrinter = useMemo(() => {
    const latestPrinter = printers.find(p => p.id === printer?.id);
    return latestPrinter || printer;
  }, [printers, printer?.id, printer]);

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
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      await updatePrinter(currentPrinter.id, {
        name: editedName,
        model: editedModel
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
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Name</Label>
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  placeholder="Printer name"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Model</Label>
                <Input
                  value={editedModel}
                  onChange={(e) => setEditedModel(e.target.value)}
                  placeholder="Printer model"
                />
              </div>
            </div>
          )}

          {!isEditing && (
            <>
              <div className="mt-8 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium">Current Status:</h3>
                    <Badge variant={getBadgeVariant(currentPrinter.status)}>{currentPrinter.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <ColorSwatch 
                      color={currentPrinter.currentColorHex && currentPrinter.currentColor 
                        ? `${currentPrinter.currentColor}|${currentPrinter.currentColorHex}`
                        : 'Black|#000000'} 
                      size="sm" 
                    />
                    <div className="flex flex-col">
                      <span className="text-sm mr-1">{currentPrinter.currentColor ? currentPrinter.currentColor.split('|')[0] : 'None'}</span>
                      <span className="text-xs text-muted-foreground">{currentPrinter.currentFilamentType || 'PLA'}</span>
                    </div>
                    <PrinterColorSelector printer={currentPrinter} />
                  </div>
                </div>
                
                {currentPrinter.status === 'printing' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">File:</span>
                        <span className="text-sm font-medium">Sample Print Job</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Time Remaining:</span>
                        <span className="text-sm font-medium">2h 15m</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Layers:</span>
                        <span className="text-sm font-medium">156/240</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Progress</span>
                        <span>65%</span>
                      </div>
                      <Progress value={65} className="h-2" />
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-red-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Nozzle</p>
                        <p className="text-lg font-medium">210°C</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="nozzle-temp" className="text-sm">Set Temp:</Label>
                      <Input
                        id="nozzle-temp"
                        type="number"
                        value={nozzleTemp}
                        onChange={(e) => setNozzleTemp(e.target.value)}
                        className="w-20 h-8"
                        placeholder="210"
                      />
                      <span className="text-sm text-muted-foreground">°C</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Square className="h-4 w-4 text-blue-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Bed</p>
                        <p className="text-lg font-medium">60°C</p>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8 ml-2">
                        <Lightbulb className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="bed-temp" className="text-sm">Set Temp:</Label>
                      <Input
                        id="bed-temp"
                        type="number"
                        value={bedTemp}
                        onChange={(e) => setBedTemp(e.target.value)}
                        className="w-20 h-8"
                        placeholder="60"
                      />
                      <span className="text-sm text-muted-foreground">°C</span>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium">System Info</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Print Time:</span>
                    <span>342h 15m</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Maintenance:</span>
                    <span>2 weeks ago</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Firmware:</span>
                    <span>v2.1.2</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Connection:</span>
                    <span className="text-green-600">Online</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                <Button onClick={handleSave}>Save Changes</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={onClose}>Close</Button>
                <Button variant="outline" onClick={handleEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button>Send G-Code</Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PrinterDetailsModal;
