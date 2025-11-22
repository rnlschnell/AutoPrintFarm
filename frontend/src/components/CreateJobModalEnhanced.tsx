import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Package, RefreshCw, AlertTriangle } from "lucide-react";
import ProductSelector from "@/components/ProductSelector";
import SkuSelector from "@/components/SkuSelector";
import { usePrinters } from "@/hooks/usePrinters";
import { useTenant } from "@/hooks/useTenant";
import { usePrintJobProcessor, type EnhancedJobRequest, type ObjectCountData } from "@/hooks/usePrintJobProcessor";

interface CreateJobModalEnhancedProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated?: () => void;
}

interface JobFormData {
  productId: string;
  skuId: string;
  selectionMode: 'manual' | 'auto';
  printerId: string;
}

interface Sku {
  id: string;
  product_id: string;
  sku: string;
  color: string;
  filament_type: string;
  hex_code: string;
  quantity: number;
  stock_level: number;
  price: number;
  is_active: number;
  finishedGoodsStock?: number;
}

// Normalize printer model names to Bambu code IDs
const normalizePrinterModel = (printerModel: string): string | null => {
  if (!printerModel) return null;

  const modelClean = printerModel.trim().toLowerCase().replace('-', ' ');

  const modelMap: Record<string, string> = {
    'a1 mini': 'N1',
    'a1mini': 'N1',
    'a1m': 'N1',
    'n1': 'N1',
    'a1': 'N2S',
    'n2s': 'N2S',
    'p1p': 'P1P',
    'p1s': 'P1S',
    'x1': 'X1',
    'x1 carbon': 'X1C',
    'x1carbon': 'X1C',
    'x1c': 'X1C',
    'x1 enterprise': 'X1E',
    'x1enterprise': 'X1E',
    'x1e': 'X1E',
  };

  return modelMap[modelClean] || null;
};

const CreateJobModalEnhanced = ({ isOpen, onClose, onJobCreated }: CreateJobModalEnhancedProps) => {
  const [formData, setFormData] = useState<JobFormData>({
    productId: '',
    skuId: '',
    selectionMode: 'manual',
    printerId: ''
  });

  const [selectedSku, setSelectedSku] = useState<Sku | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [clearingTaskCreated, setClearingTaskCreated] = useState(false);

  const { toast } = useToast();
  const { tenant } = useTenant();
  const { printers, loading: printersLoading, refetch: refetchPrinters } = usePrinters();
  const { processing, createEnhancedJob, testConnection, getObjectCount } = usePrintJobProcessor();

  const [objectCountData, setObjectCountData] = useState<ObjectCountData | null>(null);
  const [loadingObjectCount, setLoadingObjectCount] = useState(false);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        productId: '',
        skuId: '',
        selectionMode: 'manual',
        printerId: ''
      });
      setSelectedSku(null);
      setValidationError(null);
      setClearingTaskCreated(false);
    }
  }, [isOpen]);

  // Fetch selected SKU details when skuId changes
  useEffect(() => {
    if (!formData.skuId) {
      setSelectedSku(null);
      return;
    }

    const fetchSkuDetails = async () => {
      try {
        const response = await fetch('/api/product-skus-sync/');
        if (!response.ok) throw new Error('Failed to fetch SKUs');
        const allSkus = await response.json();

        const sku = allSkus.find((s: Sku) => s.id === formData.skuId);
        setSelectedSku(sku || null);
      } catch (error) {
        console.error('Error fetching SKU details:', error);
        setSelectedSku(null);
      }
    };

    fetchSkuDetails();
  }, [formData.skuId]);

  // Fetch object count and projected stock when product and printer are selected
  useEffect(() => {
    if (!formData.productId || !formData.printerId) {
      setObjectCountData(null);
      return;
    }

    const fetchObjectCount = async () => {
      setLoadingObjectCount(true);
      try {
        const data = await getObjectCount(
          formData.productId,
          formData.printerId,
          formData.skuId || undefined
        );
        setObjectCountData(data);
      } catch (error) {
        console.error('Error fetching object count:', error);
        setObjectCountData(null);
      } finally {
        setLoadingObjectCount(false);
      }
    };

    fetchObjectCount();
  }, [formData.productId, formData.printerId, formData.skuId]);

  const handleCreateJob = async () => {

    // Validation
    if (!formData.productId) {
      toast({
        title: "Error",
        description: "Please select a product.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.skuId) {
      toast({
        title: "Error",
        description: "Please select a SKU.",
        variant: "destructive",
      });
      return;
    }

    // Only require printer selection when in manual mode
    if (formData.selectionMode === 'manual' && !formData.printerId) {
      toast({
        title: "Error",
        description: "Please select a printer.",
        variant: "destructive",
      });
      return;
    }

    // Check if selected printer is in maintenance
    if (formData.selectionMode === 'manual' && formData.printerId) {
      const selectedPrinter = printers.find(p => p.id === formData.printerId);
      const isInMaintenance = selectedPrinter?.inMaintenance;

      if (isInMaintenance) {
        toast({
          title: "Printer Unavailable",
          description: "The selected printer is currently under maintenance. Please complete the maintenance or select a different printer.",
          variant: "destructive",
        });
        return;
      }

      // Check if selected printer needs bed clearing
      const isConnected = selectedPrinter?.connected;
      const needsClearing = isConnected && (selectedPrinter?.cleared === false || selectedPrinter?.cleared === 0);

      if (needsClearing) {
        // Fetch print file data to get build plate info for the selected product and printer model
        let buildPlate = 'Unknown';
        try {
          const printFilesResponse = await fetch('/api/print-files-sync/');

          if (printFilesResponse.ok) {
            const printFiles = await printFilesResponse.json();

            // Normalize printer model to Bambu code (e.g., "A1 Mini" -> "N1", "A1" -> "N2S")
            const printerModelCode = normalizePrinterModel(selectedPrinter.model);

            // Find the print file for this product and printer model
            const matchingFile = printFiles.find((f: any) =>
              f.product_id === formData.productId &&
              f.printer_model_id === printerModelCode
            );

            if (matchingFile && matchingFile.curr_bed_type) {
              buildPlate = matchingFile.curr_bed_type;
            }
          }
        } catch (error) {
          console.error('Failed to fetch print file data:', error);
        }

        // Create worklist task for clearing the printer bed
        try {
          await fetch('/api/worklist/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Clear Printer Bed - ${selectedPrinter.name}`,
              subtitle: selectedPrinter.model,
              description: `Clear the build plate for ${selectedPrinter.name} to start the print job.`,
              task_type: 'collection',
              priority: 'high',
              status: 'pending',
              printer_id: selectedPrinter.id,
              metadata: {
                auto_created: true,
                reason: 'print_job_creation_blocked',
                printer_name: selectedPrinter.name,
                printer_model: selectedPrinter.model,
                build_plate_needed: buildPlate
              }
            })
          });
          setClearingTaskCreated(true);
        } catch (error) {
          console.error('Failed to create clearing task:', error);
          setClearingTaskCreated(true);
        }
        return;
      }
    }

    // Auto-select mode is not yet implemented
    if (formData.selectionMode === 'auto') {
      toast({
        title: "Coming Soon",
        description: "Auto-select mode is not yet available. Please use manual selection.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedSku) {
      toast({
        title: "Error",
        description: "SKU details not found.",
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

    // Prepare enhanced job request with SKU data
    const request: EnhancedJobRequest = {
      job_type: 'product',
      target_id: formData.productId,
      product_sku_id: formData.skuId,
      printer_id: selectedPrinter.printerId.toString(),
      color: `${selectedSku.color}|${selectedSku.hex_code}`,
      filament_type: selectedSku.filament_type,
      material_type: selectedSku.filament_type,
      copies: 1,
      start_print: true
    };

    try {
      const result = await createEnhancedJob(request);

      if (result.success) {
        setValidationError(null);

        // Build success message with stock information if available
        let description = `Job created successfully! ${result.processing_status?.auto_start ? 'Print should start automatically.' : 'File uploaded to printer.'}`;
        if (result.processing_status?.quantity_per_print) {
          description += `\n${result.processing_status.quantity_per_print} objects will be printed.`;
        }
        if (result.processing_status?.projected_stock !== undefined && result.processing_status?.current_stock !== undefined) {
          description += `\nStock: ${result.processing_status.current_stock} → ${result.processing_status.projected_stock}`;
        }

        toast({
          title: "Success",
          description,
        });

        onClose();
        if (onJobCreated) {
          onJobCreated();
        }
      } else {
        // Check if this is a file validation error (case-insensitive)
        const errorMsg = result.message?.toLowerCase() || '';
        if (errorMsg.includes('file validation') || errorMsg.includes('print file not available')) {
          setValidationError("There is no print file for that printer model in the selected product. Please choose a different printer, or add a new file to that product.");
        } else {
          // For other errors, show toast
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
      }
    } catch (error) {
      console.error('Job creation error:', error);
      toast({
        title: "Network Error",
        description: "Failed to communicate with printer. Check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  const updateFormData = (updates: Partial<JobFormData>) => {
    // Clear validation error when printer or product changes
    if (updates.printerId || updates.productId) {
      setValidationError(null);
    }
    // Clear clearing task created flag when printer changes
    if (updates.printerId) {
      setClearingTaskCreated(false);
    }
    setFormData(prev => ({ ...prev, ...updates }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Create Print Job
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Product Selection */}
          <ProductSelector
            value={formData.productId}
            onValueChange={(value) => updateFormData({ productId: value, skuId: '' })}
            disabled={processing}
          />

          {/* SKU Selection */}
          <SkuSelector
            productId={formData.productId}
            value={formData.skuId}
            onValueChange={(value) => updateFormData({ skuId: value })}
            disabled={processing}
          />

          {/* Selection Mode */}
          <div className="space-y-2">
            <ToggleGroup
              type="single"
              value={formData.selectionMode}
              onValueChange={(value: 'manual' | 'auto') => {
                if (value) updateFormData({ selectionMode: value, printerId: '' });
              }}
              disabled={processing}
              className="w-full"
            >
              <ToggleGroupItem
                value="manual"
                className="flex-1 data-[state=on]:bg-blue-600 data-[state=on]:text-white"
              >
                Manually Select
              </ToggleGroupItem>
              <ToggleGroupItem
                value="auto"
                className="flex-1 data-[state=on]:bg-blue-600 data-[state=on]:text-white"
              >
                Auto-Select (Coming Soon)
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {formData.selectionMode === 'manual'
                ? 'Manually choose which printer to use for this job.'
                : 'Automatically select the best available printer (coming soon).'}
            </p>
          </div>

          {/* Printer Selection - Only show in manual mode */}
          {formData.selectionMode === 'manual' && (
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
                  {printers.map((printer) => {
                    const isConnected = printer.connected;
                    const isCleared = printer.cleared !== false && printer.cleared !== 0; // Check for both false and 0
                    const isInMaintenance = printer.inMaintenance;

                    // Determine dot color and badge
                    let dotColor = 'bg-gray-400'; // offline
                    let showNeedsClearing = false;
                    let showOffline = false;
                    let showInMaintenance = false;

                    if (!isConnected) {
                      // Offline: grey dot, show "(offline)"
                      dotColor = 'bg-gray-400';
                      showOffline = true;
                    } else if (isInMaintenance) {
                      // In maintenance: red dot, show badge
                      dotColor = 'bg-red-500';
                      showInMaintenance = true;
                    } else if (!isCleared) {
                      // Connected but needs clearing: amber dot, show badge
                      dotColor = 'bg-amber-500';
                      showNeedsClearing = true;
                    } else {
                      // Connected and cleared: green dot
                      dotColor = 'bg-green-500';
                    }

                    return (
                      <SelectItem key={printer.id} value={printer.id}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                          <span>{printer.name} ({printer.model})</span>
                          {showInMaintenance && (
                            <Badge variant="destructive" className="text-xs">In Maintenance</Badge>
                          )}
                          {showNeedsClearing && (
                            <Badge variant="warning" className="text-xs">Needs Clearing</Badge>
                          )}
                          {showOffline && (
                            <span className="text-xs text-muted-foreground">(offline)</span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Required for printing. Click refresh to update connection status.
              </p>

              {/* Warning when maintenance or uncleared printer is selected */}
              {formData.printerId && (() => {
                const selectedPrinter = printers.find(p => p.id === formData.printerId);
                const isInMaintenance = selectedPrinter?.inMaintenance;
                const isConnected = selectedPrinter?.connected;
                const needsClearing = isConnected && (selectedPrinter?.cleared === false || selectedPrinter?.cleared === 0);

                if (isInMaintenance) {
                  return (
                    <Alert className="border-red-500 bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600 self-start mt-0.5" />
                      <AlertDescription className="text-red-800">
                        The selected printer is currently under maintenance. Please complete the maintenance or select a different printer.
                      </AlertDescription>
                    </Alert>
                  );
                }

                if (needsClearing) {
                  return (
                    <Alert className={clearingTaskCreated ? "border-green-500 bg-green-50" : "border-amber-500 bg-amber-50"}>
                      <AlertTriangle className={`h-4 w-4 ${clearingTaskCreated ? "text-green-600" : "text-amber-600"} self-start mt-0.5`} />
                      <AlertDescription className={clearingTaskCreated ? "text-green-800" : "text-amber-800"}>
                        {clearingTaskCreated
                          ? "A task has been created to clear build plate for the selected printer. Once you complete the task, the print job will start."
                          : "This printer's bed needs to be cleared before starting a new print job."}
                      </AlertDescription>
                    </Alert>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {/* Validation Error Display */}
          {validationError && (
            <div className="p-3 border rounded-lg bg-yellow-50 border-yellow-200">
              <p className="text-sm text-yellow-800">
                {validationError}
              </p>
            </div>
          )}

          {/* Selected SKU Info Display */}
          {selectedSku && (
            <div className="p-3 border rounded-lg bg-muted/50">
              <div className="text-sm font-medium mb-2">Job Details:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Material: </span>
                  <span className="font-medium">{selectedSku.filament_type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Color: </span>
                  <span className="font-medium">{selectedSku.color}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Current Stock: </span>
                  <span className="font-medium">{selectedSku.finishedGoodsStock || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Projected Stock: </span>
                  {loadingObjectCount ? (
                    <span className="font-medium text-muted-foreground">Calculating...</span>
                  ) : objectCountData && objectCountData.projected_stock !== null ? (
                    <span className="font-medium">
                      {objectCountData.projected_stock}
                    </span>
                  ) : (
                    <span className="font-medium text-muted-foreground">N/A</span>
                  )}
                </div>
              </div>
            </div>
          )}

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
            disabled={processing || printersLoading || !formData.productId || !formData.skuId || (formData.selectionMode === 'manual' && !formData.printerId)}
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