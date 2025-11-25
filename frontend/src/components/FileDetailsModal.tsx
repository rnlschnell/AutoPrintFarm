import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { FileText, Clock, Package, Printer, Settings, Loader2, Edit2, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api-client';

interface FileDetailsModalProps {
  printFileId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface PrintFileMetadata {
  id: string;
  name: string;
  print_time_seconds?: number | null;
  filament_weight_grams?: number | null;
  filament_length_meters?: number | null;
  filament_type?: string | null;
  printer_model_id?: string | null;
  nozzle_diameter?: number | null;
  layer_count?: number | null;
  curr_bed_type?: string | null;
  default_print_profile?: string | null;
  file_size_bytes?: number | null;
  object_count?: number | null;
}

// Printer model mapping
const PRINTER_MODEL_MAP: Record<string, string> = {
  'N1': 'A1 mini',
  'N2S': 'A1',
  'P1P': 'P1P',
  'X1': 'X1-Carbon',
  'C12': 'X1-Carbon',
};

// Format seconds to human-readable time
const formatPrintTime = (seconds?: number | null): string => {
  if (!seconds) return 'N/A';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
};

// Format printer model ID to friendly name
const formatPrinterModel = (modelId?: string | null): string => {
  if (!modelId) return 'N/A';
  return PRINTER_MODEL_MAP[modelId] || modelId;
};

export const FileDetailsModal = ({ printFileId, isOpen, onClose }: FileDetailsModalProps) => {
  const [metadata, setMetadata] = useState<PrintFileMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingObjectCount, setEditingObjectCount] = useState(false);
  const [objectCountValue, setObjectCountValue] = useState<string>('');
  const [savingObjectCount, setSavingObjectCount] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && printFileId) {
      fetchFileMetadata();
    }
  }, [isOpen, printFileId]);

  const fetchFileMetadata = async () => {
    if (!printFileId) return;

    try {
      setLoading(true);
      // Use cloud API endpoint
      const data = await api.get<PrintFileMetadata>(`/api/v1/files/${printFileId}`);
      setMetadata(data);
    } catch (error) {
      console.error('Error fetching print file metadata:', error);
      // Don't show error toast for auth errors (user will be redirected)
      if (error instanceof ApiError && error.isAuthError()) {
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load file metadata. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startEditingObjectCount = () => {
    setObjectCountValue(String(metadata?.object_count || 1));
    setEditingObjectCount(true);
  };

  const cancelEditingObjectCount = () => {
    setEditingObjectCount(false);
    setObjectCountValue('');
  };

  const saveObjectCount = async () => {
    if (!printFileId || !objectCountValue) return;

    const newCount = parseInt(objectCountValue, 10);
    if (isNaN(newCount) || newCount < 1) {
      toast({
        title: "Invalid Value",
        description: "Object count must be a positive number (at least 1).",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingObjectCount(true);
      // Use cloud API endpoint - PUT to update the file with object_count
      await api.put(`/api/v1/files/${printFileId}`, { object_count: newCount });

      // Update local state with new value
      if (metadata) {
        setMetadata({ ...metadata, object_count: newCount });
      }

      toast({
        title: "Success",
        description: "Object count updated successfully.",
      });

      setEditingObjectCount(false);
    } catch (error) {
      console.error('Error updating object count:', error);
      toast({
        title: "Error",
        description: "Failed to update object count. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingObjectCount(false);
    }
  };

  const hasMetadata = metadata && (
    metadata.print_time_seconds ||
    metadata.filament_weight_grams ||
    metadata.filament_length_meters ||
    metadata.filament_type ||
    metadata.printer_model_id ||
    metadata.nozzle_diameter ||
    metadata.layer_count ||
    metadata.curr_bed_type ||
    metadata.default_print_profile ||
    metadata.object_count
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Print File Details
          </DialogTitle>
          <DialogDescription>
            {metadata?.name || 'Loading file information...'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasMetadata ? (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-muted-foreground mb-2">No metadata available for this file</p>
            <p className="text-sm text-muted-foreground">
              This file may not be a 3MF file or was uploaded before metadata extraction was enabled.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Print Information */}
            {(metadata.print_time_seconds || metadata.layer_count || metadata.object_count) && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold">Print Information</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {metadata.print_time_seconds && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Estimated Print Time</span>
                        <p className="text-lg font-medium">{formatPrintTime(metadata.print_time_seconds)}</p>
                      </div>
                    )}
                    {metadata.layer_count && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Layer Count</span>
                        <p className="text-lg font-medium">{metadata.layer_count} layers</p>
                      </div>
                    )}
                    {metadata.object_count !== undefined && metadata.object_count !== null && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Objects</span>
                        {editingObjectCount ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="1"
                              value={objectCountValue}
                              onChange={(e) => setObjectCountValue(e.target.value)}
                              className="h-9 w-20"
                              disabled={savingObjectCount}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={saveObjectCount}
                              disabled={savingObjectCount}
                              className="h-9 w-9 p-0"
                            >
                              {savingObjectCount ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEditingObjectCount}
                              disabled={savingObjectCount}
                              className="h-9 w-9 p-0"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-lg font-medium">
                              {metadata.object_count} {metadata.object_count === 1 ? 'object' : 'objects'}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={startEditingObjectCount}
                              className="h-8 w-8 p-0"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Filament Details */}
            {(metadata.filament_weight_grams || metadata.filament_length_meters || metadata.filament_type) && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold">Filament Details</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {metadata.filament_type && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Material Type</span>
                        <div>
                          <Badge variant="secondary">{metadata.filament_type}</Badge>
                        </div>
                      </div>
                    )}
                    {metadata.filament_weight_grams && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Filament Weight</span>
                        <p className="text-lg font-medium">{metadata.filament_weight_grams.toFixed(2)}g</p>
                      </div>
                    )}
                    {metadata.filament_length_meters && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Filament Length</span>
                        <p className="text-lg font-medium">{metadata.filament_length_meters.toFixed(2)}m</p>
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Printer Settings */}
            {(metadata.printer_model_id || metadata.nozzle_diameter || metadata.curr_bed_type) && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Printer className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold">Printer Settings</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {metadata.printer_model_id && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Printer Model</span>
                        <p className="text-lg font-medium">{formatPrinterModel(metadata.printer_model_id)}</p>
                      </div>
                    )}
                    {metadata.nozzle_diameter && (
                      <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">Nozzle Diameter</span>
                        <p className="text-lg font-medium">{metadata.nozzle_diameter}mm</p>
                      </div>
                    )}
                    {metadata.curr_bed_type && (
                      <div className="space-y-1 col-span-2">
                        <span className="text-sm text-muted-foreground">Bed Type</span>
                        <p className="text-lg font-medium">{metadata.curr_bed_type}</p>
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Print Profile */}
            {metadata.default_print_profile && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">Print Profile</h3>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Default Profile</span>
                  <p className="text-base font-mono bg-muted px-3 py-2 rounded-md">
                    {metadata.default_print_profile}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
