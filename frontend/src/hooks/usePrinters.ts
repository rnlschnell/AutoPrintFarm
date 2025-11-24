import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  FrontendPrinter,
  transformPrinterFromDb,
  transformPrinterToDb,
} from '@/lib/transformers';
import type { Printer as ApiPrinter } from '@/types/api';

export type { FrontendPrinter as Printer };

export const usePrinters = () => {
  const [printers, setPrinters] = useState<FrontendPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenantId } = useAuth();

  // Track recent local updates to preserve them during fetchPrinters calls
  const recentUpdatesRef = useRef<Map<string, { timestamp: number; printer: FrontendPrinter }>>(new Map());

  const fetchPrinters = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      // Get printers from Cloud API
      const response = await api.get<ApiPrinter[]>('/api/v1/printers', {
        params: { limit: 100 }
      });

      if (!Array.isArray(response)) {
        throw new Error('Invalid response from server');
      }

      // Transform database data to frontend format
      const transformedData = response.map(transformPrinterFromDb);

      // Merge with recent local updates (within last 5 seconds)
      const now = Date.now();
      const mergedPrinters = transformedData.map(printer => {
        const recentUpdate = recentUpdatesRef.current.get(printer.id);
        const isRecentUpdate = recentUpdate && (now - recentUpdate.timestamp) < 5000;

        if (isRecentUpdate) {
          return {
            ...recentUpdate.printer,
            // Still update connection status from server
            status: printer.status,
            connected: printer.connected
          };
        }
        return printer;
      });

      // Sort by sortOrder
      mergedPrinters.sort((a, b) => a.sortOrder - b.sortOrder);

      setPrinters([...mergedPrinters]);

      // Clean up old entries from recentUpdatesRef (older than 10 seconds)
      for (const [printerId, update] of recentUpdatesRef.current.entries()) {
        if (now - update.timestamp > 10000) {
          recentUpdatesRef.current.delete(printerId);
        }
      }
    } catch (error) {
      console.error('Error fetching printers:', error);
      if (error instanceof ApiError && error.isAuthError()) {
        // Don't show toast for auth errors - let AuthContext handle it
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load printers from server.",
        variant: "destructive",
      });
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  const addPrinter = async (printer: Omit<FrontendPrinter, 'id' | 'printerId' | 'tenantId' | 'createdAt' | 'updatedAt'>) => {
    if (!tenantId) {
      throw new Error('No tenant ID available');
    }

    try {
      // Send to Cloud API
      const response = await api.post<ApiPrinter>('/api/v1/printers', {
        name: printer.name,
        model: printer.model,
        manufacturer: printer.manufacturer,
        ip_address: printer.ipAddress,
        access_code: printer.accessCode,
        serial_number: printer.serialNumber,
        firmware_version: printer.firmwareVersion,
        location: printer.location,
        sort_order: printer.sortOrder || 0,
        connection_type: printer.connectionType || 'bambu',
      });

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(response);

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
      // Transform to API format
      const apiUpdates = transformPrinterToDb(updates);

      // Send to Cloud API
      const response = await api.put<ApiPrinter>(`/api/v1/printers/${id}`, apiUpdates);

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(response);

      // Track this as a recent update FIRST (before any fetches)
      recentUpdatesRef.current.set(id, {
        timestamp: Date.now(),
        printer: transformedPrinter
      });

      // Update local state immediately
      setPrinters(prev => prev.map(p => p.id === id ? transformedPrinter : p));

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

      // Send to Cloud API
      await api.delete(`/api/v1/printers/${id}`);

      // Remove from recent updates tracking
      recentUpdatesRef.current.delete(id);

      toast({
        title: "Success",
        description: "Printer removed from fleet.",
      });
    } catch (error) {
      console.error('Error deleting printer:', error);
      // Restore on error by refetching
      await fetchPrinters();
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
      // Update sort_order for all printers using batch update
      const updates = reorderedPrinters.map((printer, index) => ({
        id: printer.id,
        sort_order: index + 1
      }));

      // Send batch update to Cloud API
      await api.put('/api/v1/printers/order', { printers: updates });

      // Update local state
      setPrinters(reorderedPrinters.map((p, i) => ({ ...p, sortOrder: i + 1 })));

    } catch (error) {
      console.error('Error updating printer order:', error);
      // Fallback to individual updates
      for (let i = 0; i < reorderedPrinters.length; i++) {
        const printer = reorderedPrinters[i];
        await updatePrinter(printer.id, { sortOrder: i + 1 });
      }
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
      const response = await api.put<ApiPrinter>(`/api/v1/printers/${printerId}/cleared`);

      // Transform and update state
      const transformedPrinter = transformPrinterFromDb(response);

      setPrinters(prev => prev.map(p =>
        p.id === printerId ? transformedPrinter : p
      ));

      return { success: true, cleared: transformedPrinter.cleared };
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

  const toggleMaintenance = async (printerId: string, maintenanceType?: string) => {
    try {
      // Call the maintenance toggle API endpoint
      const response = await api.put<ApiPrinter>(`/api/v1/printers/${printerId}/maintenance`, {
        maintenance_type: maintenanceType
      });

      // Transform and update state
      const transformedPrinter = transformPrinterFromDb(response);

      setPrinters(prev => prev.map(p =>
        p.id === printerId ? transformedPrinter : p
      ));

      return { success: true, inMaintenance: transformedPrinter.inMaintenance };
    } catch (error) {
      console.error('Error toggling maintenance:', error);
      toast({
        title: "Error",
        description: "Failed to update maintenance status.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Printer control commands
  const connectPrinter = async (printerId: string) => {
    try {
      await api.post(`/api/v1/printers/${printerId}/connect`);
      await fetchPrinters();
      toast({
        title: "Success",
        description: "Printer connection initiated.",
      });
    } catch (error) {
      console.error('Error connecting printer:', error);
      toast({
        title: "Error",
        description: "Failed to connect to printer.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const disconnectPrinter = async (printerId: string) => {
    try {
      await api.post(`/api/v1/printers/${printerId}/disconnect`);
      await fetchPrinters();
      toast({
        title: "Success",
        description: "Printer disconnected.",
      });
    } catch (error) {
      console.error('Error disconnecting printer:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect printer.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const controlPrinter = async (printerId: string, action: 'pause' | 'resume' | 'stop') => {
    try {
      await api.post(`/api/v1/printers/${printerId}/control`, { action });
      await fetchPrinters();

      const actionText = action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'stopped';
      toast({
        title: "Success",
        description: `Print ${actionText}.`,
      });
    } catch (error) {
      console.error(`Error ${action}ing printer:`, error);
      toast({
        title: "Error",
        description: `Failed to ${action} print.`,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Initial fetch - only on mount or tenant change
  useEffect(() => {
    if (tenantId) {
      fetchPrinters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return {
    printers,
    loading,
    addPrinter,
    updatePrinter,
    deletePrinter,
    updatePrintersOrder,
    toggleCleared,
    toggleMaintenance,
    connectPrinter,
    disconnectPrinter,
    controlPrinter,
    refetch: fetchPrinters
  };
};
