import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Zap, RefreshCw } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";
import OptionSelector from "@/components/OptionSelector";
import PrintFileSelector from "@/components/PrintFileSelector";
import ProductSelector from "@/components/ProductSelector";
import { useColorPresetsContext } from "@/contexts/ColorPresetsContext";
import { usePrinters } from "@/hooks/usePrinters";
import { useTenant } from "@/hooks/useTenant";
import { usePrintJobProcessor, type EnhancedJobRequest } from "@/hooks/usePrintJobProcessor";

interface CreateJobModalEnhancedProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated?: () => void; // Callback when job is successfully created
}

interface JobFormData {
  jobType: 'print_file' | 'product';
  targetId: string;
  printerId: string;
  color: string;
}

const CreateJobModalEnhanced = ({ isOpen, onClose, onJobCreated }: CreateJobModalEnhancedProps) => {
  const [formData, setFormData] = useState<JobFormData>({
    jobType: 'print_file',
    targetId: '',
    printerId: '',
    color: ''
  });


  const { toast } = useToast();
  const { tenant } = useTenant();
  const { colorPresets } = useColorPresetsContext();
  const { printers, loading: printersLoading, refetch: refetchPrinters } = usePrinters();
  const { processing, createEnhancedJob, testConnection } = usePrintJobProcessor();

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        jobType: 'print_file',
        targetId: '',
        printerId: '',
        color: ''
      });
    }
  }, [isOpen]);

  const handleCreateJob = async () => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "You must be logged in to create print jobs.",
        variant: "destructive",
      });
      return;
    }

    // Validation
    if (!formData.targetId) {
      toast({
        title: "Error",
        description: `Please select a ${formData.jobType === 'product' ? 'product' : 'print file'}.`,
        variant: "destructive",
      });
      return;
    }

    if (!formData.printerId) {
      toast({
        title: "Error",
        description: "Please select a printer.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.color) {
      toast({
        title: "Error",
        description: "Please select a filament color.",
        variant: "destructive",
      });
      return;
    }


    // Parse color and filament type from color preset
    const [colorName, hexCode] = formData.color.split('|');
    const selectedColorPreset = colorPresets.find(p => 
      p.color_name === colorName && p.hex_code === hexCode
    );
    
    if (!selectedColorPreset) {
      toast({
        title: "Error",
        description: "Selected color preset not found.",
        variant: "destructive",
      });
      return;
    }

    // Test connection to Pi before proceeding
    const isConnected = await testConnection();
    if (!isConnected) {
      toast({
        title: "Connection Error",
        description: "Cannot connect to Pi. Check network connection and try again.",
        variant: "destructive",
      });
      return;
    }

    // Find the selected printer to get its printerId
    const selectedPrinter = printers.find(p => p.id === formData.printerId);
    if (!selectedPrinter || !selectedPrinter.printerId) {
      toast({
        title: "Error",
        description: "Selected printer not found or invalid printer ID.",
        variant: "destructive",
      });
      return;
    }

    // Prepare enhanced job request - use printerId (4 or 7) not the database UUID
    const request: EnhancedJobRequest = {
      job_type: formData.jobType,
      target_id: formData.targetId,
      printer_id: selectedPrinter.printerId.toString(), // Send the actual printer ID (4 or 7)
      color: formData.color,
      filament_type: selectedColorPreset.filament_type,
      material_type: selectedColorPreset.filament_type, // Using filament_type as material_type
      copies: 1, // Fixed to 1 copy
      start_print: true // Always start printing immediately
    };

    try {
      const result = await createEnhancedJob(request);
      
      if (result.success) {
        // Job created successfully
        toast({
          title: "Success",
          description: `Job created successfully! ${result.processing_status?.auto_start ? 'Print should start automatically.' : 'File uploaded to printer.'}`,
        });
        
        onClose();
        if (onJobCreated) {
          onJobCreated();
        }
      } else {
        // Handle detailed error from backend
        let errorMessage = result.message || "Unknown error occurred";
        if (result.error_details) {
          errorMessage += `. Details: ${result.error_details}`;
        }
        
        toast({
          title: "Job Creation Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error) {
      // Handle network or other errors
      console.error('Job creation error:', error);
      toast({
        title: "Network Error", 
        description: "Failed to communicate with printer. Check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  const updateFormData = (updates: Partial<JobFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Create Enhanced Print Job
          </DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {/* Job Type Selector */}
          <OptionSelector
            value={formData.jobType}
            onValueChange={(value) => updateFormData({ jobType: value, targetId: '' })}
            disabled={processing}
          />

          {/* Target Selector (Print File or Product) */}
          {formData.jobType === 'print_file' ? (
            <PrintFileSelector
              value={formData.targetId}
              onValueChange={(value) => updateFormData({ targetId: value })}
              disabled={processing}
            />
          ) : (
            <ProductSelector
              value={formData.targetId}
              onValueChange={(value) => updateFormData({ targetId: value })}
              disabled={processing}
            />
          )}

          {/* Printer Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="printer">Printer *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={refetchPrinters}
                disabled={processing || printersLoading}
                className="h-6 px-2"
              >
                <RefreshCw className={`h-3 w-3 ${printersLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <Select 
              value={formData.printerId} 
              onValueChange={(value) => updateFormData({ printerId: value })}
              disabled={processing || printersLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={printersLoading ? "Loading printers..." : "Select printer"} />
              </SelectTrigger>
              <SelectContent>
                {printers.map((printer) => (
                  <SelectItem key={printer.id} value={printer.id}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${(printer.connected || printer.status === 'idle' || printer.status === 'printing') ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <span>{printer.name} ({printer.model})</span>
                      <span className="text-xs text-muted-foreground">({printer.printerId})</span>
                      {!printer.connected && printer.status === 'offline' && (
                        <span className="text-xs text-muted-foreground">(offline)</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Required for printing. Click refresh to update connection status.
            </p>
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <Label htmlFor="color">Filament Color *</Label>
            <Select 
              value={formData.color} 
              onValueChange={(value) => updateFormData({ color: value })}
              disabled={processing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select color" />
              </SelectTrigger>
              <SelectContent>
                {colorPresets.map((preset) => (
                  <SelectItem key={preset.id} value={`${preset.color_name}|${preset.hex_code}`}>
                    <div className="flex items-center gap-2">
                      <ColorSwatch color={`${preset.color_name}|${preset.hex_code}`} size="sm" />
                      <span>{preset.color_name}</span>
                      <span className="text-xs text-muted-foreground">({preset.filament_type})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>



          {/* Processing Info */}
          {processing && (
            <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing print job...</span>
              </div>
              <p className="text-xs text-blue-600 mt-1">
                Preparing and uploading to printer. This may take several minutes.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateJob}
            disabled={!tenant?.id || processing || printersLoading}
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create & Process Job
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateJobModalEnhanced;