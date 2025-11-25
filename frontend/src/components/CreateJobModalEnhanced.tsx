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
import { usePrintJobs } from "@/hooks/usePrintJobs";
import { api } from "@/lib/api-client";

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
  finished_goods_stock?: number;
}

interface PrintFile {
  id: string;
  name: string;
  product_id?: string;
  printer_model_id?: string;
  object_count?: number;
  filament_used_g?: number;
  estimated_print_time_minutes?: number;
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
  const [processing, setProcessing] = useState(false);
  const [productFiles, setProductFiles] = useState<PrintFile[]>([]);

  const { toast } = useToast();
  const { printers, loading: printersLoading, refetch: refetchPrinters } = usePrinters();
  const { addPrintJob } = usePrintJobs();

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
      setProductFiles([]);
    }
  }, [isOpen]);

  // Fetch print files for the selected product
  useEffect(() => {
    if (!formData.productId) {
      setProductFiles([]);
      return;
    }

    const fetchProductFiles = async () => {
      try {
        const files = await api.get<PrintFile[]>('/api/v1/files', {
          params: { product_id: formData.productId }
        });
        setProductFiles(files || []);
      } catch (error) {
        console.error('Error fetching product files:', error);
        setProductFiles([]);
      }
    };

    fetchProductFiles();
  }, [formData.productId]);

  // Fetch selected SKU details when skuId changes
  useEffect(() => {
    if (!formData.skuId) {
      setSelectedSku(null);
      return;
    }

    const fetchSkuDetails = async () => {
      try {
        // Use cloud API to fetch all SKUs
        const allSkus = await api.get<Sku[]>('/api/v1/skus');

        const sku = (allSkus || []).find((s: Sku) => s.id === formData.skuId);
        setSelectedSku(sku || null);
      } catch (error) {
        console.error('Error fetching SKU details:', error);
        setSelectedSku(null);
      }
    };

    fetchSkuDetails();
  }, [formData.skuId]);

  // Find the matching print file for a printer model
  const findMatchingPrintFile = (printerModel: string): PrintFile | null => {
    if (productFiles.length === 0) return null;

    const normalizedModel = normalizePrinterModel(printerModel);

    // First try to find an exact match by printer_model_id
    if (normalizedModel) {
      const exactMatch = productFiles.find(f => f.printer_model_id === normalizedModel);
      if (exactMatch) return exactMatch;
    }

    // If no exact match, return the first available file for the product
    // (Some products may have a single file that works on multiple printers)
    return productFiles[0] || null;
  };

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

    // Find the selected printer
    const selectedPrinter = printers.find(p => p.id === formData.printerId);
    if (!selectedPrinter) {
      toast({
        title: "Error",
        description: "Selected printer not found.",
        variant: "destructive",
      });
      return;
    }

    // Find the matching print file for this printer model
    const printFile = findMatchingPrintFile(selectedPrinter.model);
    if (!printFile) {
      setValidationError("There is no print file for that printer model in the selected product. Please choose a different printer, or add a new file to that product.");
      return;
    }

    setProcessing(true);
    setValidationError(null);

    try {
      // Create the print job via cloud API
      await addPrintJob({
        printerId: formData.printerId,
        printFileId: printFile.id,
        productSkuId: formData.skuId,
        fileName: printFile.name,
        color: selectedSku.color,
        filamentType: selectedSku.filament_type,
        materialType: selectedSku.filament_type,
        numberOfUnits: printFile.object_count || 1,
        filamentNeededGrams: printFile.filament_used_g,
        estimatedPrintTimeMinutes: printFile.estimated_print_time_minutes,
        priority: 50, // Default normal priority
      });

      toast({
        title: "Success",
        description: `Print job created and added to queue.`,
      });

      onClose();
      if (onJobCreated) {
        onJobCreated();
      }
    } catch (error: any) {
      console.error('Job creation error:', error);
      toast({
        title: "Job Creation Failed",
        description: error?.message || "Failed to create print job. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const updateFormData = (updates: Partial<JobFormData>) => {
    // Clear validation error when printer or product changes
    if (updates.printerId || updates.productId) {
      setValidationError(null);
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
                    const isCleared = printer.cleared !== false && printer.cleared !== 0;
                    const isInMaintenance = printer.inMaintenance;

                    // Determine dot color and badge
                    let dotColor = 'bg-gray-400'; // offline
                    let showNeedsClearing = false;
                    let showOffline = false;
                    let showInMaintenance = false;

                    if (!isConnected) {
                      dotColor = 'bg-gray-400';
                      showOffline = true;
                    } else if (isInMaintenance) {
                      dotColor = 'bg-red-500';
                      showInMaintenance = true;
                    } else if (!isCleared) {
                      dotColor = 'bg-amber-500';
                      showNeedsClearing = true;
                    } else {
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
                Select the printer to queue this job on.
              </p>

              {/* Warning when maintenance printer is selected */}
              {formData.printerId && (() => {
                const selectedPrinter = printers.find(p => p.id === formData.printerId);
                const isInMaintenance = selectedPrinter?.inMaintenance;

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
                  <span className="font-medium">{selectedSku.finished_goods_stock || 0}</span>
                </div>
                {formData.printerId && productFiles.length > 0 && (() => {
                  const selectedPrinter = printers.find(p => p.id === formData.printerId);
                  const matchingFile = selectedPrinter ? findMatchingPrintFile(selectedPrinter.model) : null;
                  if (matchingFile?.object_count) {
                    return (
                      <div>
                        <span className="text-muted-foreground">Objects per print: </span>
                        <span className="font-medium">{matchingFile.object_count}</span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          )}

          {/* Processing Info */}
          {processing && (
            <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Creating print job...</span>
              </div>
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
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Job
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateJobModalEnhanced;
