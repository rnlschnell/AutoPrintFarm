import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import {
  FrontendPrinter,
  transformPrinterFromDb,
} from '@/lib/transformers';

export type { FrontendPrinter as Printer };

export const usePrinters = () => {
  const [printers, setPrinters] = useState<FrontendPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  // Track recent local updates to preserve them during fetchPrinters calls
  const recentUpdatesRef = useRef<Map<string, { timestamp: number; printer: FrontendPrinter }>>(new Map());

  const fetchPrinters = useCallback(async () => {
    if (!tenant?.id) return;

    try {
      // Get printers from Pi API (local-first) - SQLite is now the source of truth
      const response = await fetch('/api/printers-sync/');

      if (!response.ok) {
        throw new Error(`Failed to fetch printers: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform database data to frontend format (data is already in dict format)
      const transformedData = data.map(transformPrinterFromDb);

      // Immediately check printer connection status via HTTP API
      try {
        const statusResponse = await fetch('/api/printers/status-quick-fixed', {
          signal: AbortSignal.timeout(3000) // 3 second timeout
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (statusData.success && statusData.printers) {
            // Merge live status with database data, preserving recent local updates
            const updatedPrinters = transformedData.map(printer => {
              const liveStatus = statusData.printers.find(
                (s: any) => s.printer_id === printer.printerId?.toString()
              );

              // Check if we have a recent local update for this printer (within last 5 seconds)
              const recentUpdate = recentUpdatesRef.current.get(printer.id);
              const now = Date.now();
              const isRecentUpdate = recentUpdate && (now - recentUpdate.timestamp) < 5000;

              let updatedPrinter = printer;

              // If we have a recent local update, use the locally updated printer data
              if (isRecentUpdate) {
                updatedPrinter = {
                  ...recentUpdate.printer,
                  // But still update connection status from live data
                  status: liveStatus?.status || recentUpdate.printer.status,
                  connected: liveStatus?.connected || recentUpdate.printer.connected
                };
              } else if (liveStatus) {
                // No recent local update, use database data + live status
                updatedPrinter = {
                  ...printer,
                  status: liveStatus.status,
                  connected: liveStatus.connected
                };
              }

              return updatedPrinter;
            });

            setPrinters([...updatedPrinters]);
            console.log('[FETCH] Set printers, first 3:', updatedPrinters.slice(0, 3).map(p => ({ id: p.id.substring(0, 8), name: p.name, color: p.currentColor, hex: p.currentColorHex })));
          } else {
            // Fallback to database status if HTTP check fails
            setPrinters([...transformedData]);
          }
        } else {
          // Fallback to database status if HTTP check fails
          setPrinters([...transformedData]);
        }
      } catch (statusError) {
        console.warn('Failed to check immediate printer status, using database status:', statusError);
        // Fallback to database status if HTTP check fails
        setPrinters([...transformedData]);
      }

      // Clean up old entries from recentUpdatesRef (older than 10 seconds)
      const now = Date.now();
      for (const [printerId, update] of recentUpdatesRef.current.entries()) {
        if (now - update.timestamp > 10000) {
          recentUpdatesRef.current.delete(printerId);
        }
      }
    } catch (error: any) {
      console.error('Error fetching printers:', error);
      toast({
        title: "Error",
        description: "Failed to load printers from database.",
        variant: "destructive",
      });
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, toast]);

  const addPrinter = async (printer: Omit<FrontendPrinter, 'id' | 'printerId' | 'tenantId' | 'createdAt' | 'updatedAt'>) => {
    if (!tenant?.id) {
      throw new Error('No tenant ID available');
    }

    try {
      // Send to Pi API (local-first)
      const response = await fetch('/api/printers-sync/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: printer.name,
          model: printer.model,
          manufacturer: printer.manufacturer,
          ip_address: printer.ipAddress,
          access_code: printer.accessCode,
          serial_number: printer.serialNumber,
          firmware_version: printer.firmwareVersion,
          location: printer.location,
          sort_order: printer.sortOrder || 0,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add printer: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to add printer');
      }

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(data.printer);

      // Add to local state
      setPrinters(prev => [...prev, transformedPrinter]);

      toast({
        title: "Success",
        description: `${printer.name} has been added to your fleet.`,
      });

      return transformedPrinter;
    } catch (error) {
      console.error('Error adding printer:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add printer.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrinter = async (id: string, updates: Partial<FrontendPrinter>) => {
    try {
      // Send to Pi API (local-first)
      const response = await fetch(`/api/printers-sync/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: updates.name,
          model: updates.model,
          manufacturer: updates.manufacturer,
          ip_address: updates.ipAddress,
          access_code: updates.accessCode,
          serial_number: updates.serialNumber,
          firmware_version: updates.firmwareVersion,
          location: updates.location,
          sort_order: updates.sortOrder,
          status: updates.status,
          current_color: updates.currentColor,
          current_color_hex: updates.currentColorHex,
          current_filament_type: updates.currentFilamentType,
          current_build_plate: updates.currentBuildPlate,
          filament_level: updates.filamentLevel,
          nozzle_size: updates.nozzleSize,
          in_maintenance: updates.inMaintenance,
          maintenance_type: updates.maintenanceType,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update printer: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to update printer');
      }

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(data.printer);

      // Track this as a recent update FIRST (before any fetches)
      recentUpdatesRef.current.set(id, {
        timestamp: Date.now(),
        printer: transformedPrinter
      });

      // Update local state immediately
      setPrinters(prev => prev.map(p => p.id === id ? transformedPrinter : p));

      // Force a fresh fetch to ensure all components see the latest data
      // The recentUpdatesRef will preserve our update during the fetch
      console.log('[UPDATE] Before fetchPrinters, updated printer:', { id: id.substring(0, 8), color: transformedPrinter.currentColor, hex: transformedPrinter.currentColorHex });
      await fetchPrinters();
      console.log('[UPDATE] After fetchPrinters completed');

      toast({
        title: "Success",
        description: "Printer updated successfully.",
      });

      return transformedPrinter;
    } catch (error) {
      console.error('Error updating printer:', error);
      toast({
        title: "Error",
        description: "Failed to update printer.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deletePrinter = async (id: string) => {
    try {
      // Optimistically remove from UI immediately
      setPrinters(prev => prev.filter(p => p.id !== id));

      // Send to Pi API (local-first)
      const response = await fetch(`/api/printers-sync/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        // Restore on error by refetching
        await fetchPrinters();
        throw new Error(`Failed to delete printer: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        // Restore on error by refetching
        await fetchPrinters();
        throw new Error(data.message || 'Failed to delete printer');
      }

      // Remove from recent updates tracking
      recentUpdatesRef.current.delete(id);

      toast({
        title: "Success",
        description: "Printer removed from fleet.",
      });
    } catch (error) {
      console.error('Error deleting printer:', error);
      toast({
        title: "Error",
        description: "Failed to remove printer.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updatePrintersOrder = async (reorderedPrinters: FrontendPrinter[]) => {
    try {
      // Update sort_order for all printers using local API
      for (let i = 0; i < reorderedPrinters.length; i++) {
        const printer = reorderedPrinters[i];
        await updatePrinter(printer.id, { sortOrder: i + 1 });
      }

      setPrinters(reorderedPrinters);

    } catch (error) {
      console.error('Error updating printer order:', error);
      toast({
        title: "Error",
        description: "Failed to save printer order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const toggleCleared = async (printerId: string) => {
    try {
      // Call the cleared toggle API endpoint
      const response = await fetch(`/api/printers/${printerId}/cleared/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to toggle cleared status: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to toggle cleared status');
      }

      // Refetch printers to get the updated cleared status
      await fetchPrinters();

      return data;
    } catch (error) {
      console.error('Error toggling cleared status:', error);
      toast({
        title: "Error",
        description: "Failed to update cleared status.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Initial fetch - only on mount or tenant change
  useEffect(() => {
    if (tenant?.id) {
      fetchPrinters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  return {
    printers,
    loading,
    addPrinter,
    updatePrinter,
    deletePrinter,
    updatePrintersOrder,
    toggleCleared,
    refetch: fetchPrinters
  };
};