
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { 
  FrontendPrinter, 
  transformPrinterFromDb, 
  transformPrinterToDb,
  DbPrinter 
} from '@/lib/transformers';

export type { FrontendPrinter as Printer };

export const usePrinters = () => {
  const [printers, setPrinters] = useState<FrontendPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const fetchPrinters = useCallback(async () => {
    if (!tenant?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('printers')
        .select('*')
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      
      // Transform the data to match our Printer interface
      const transformedData: FrontendPrinter[] = (data || []).map(printer => 
        transformPrinterFromDb(printer as DbPrinter)
      );
      
      setPrinters(transformedData);
    } catch (error) {
      console.error('Error fetching printers:', error);
      toast({
        title: "Error",
        description: "Failed to load printers from database.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, toast]);

  const addPrinter = async (printer: Omit<FrontendPrinter, 'id' | 'printerId' | 'tenantId' | 'createdAt' | 'updatedAt'>) => {
    if (!tenant?.id) {
      throw new Error('No tenant ID available');
    }

    try {
      // Transform printer data to database format
      const printerData = transformPrinterToDb({
        ...printer,
        tenantId: tenant.id,
        status: 'offline',
        isActive: true
      });

      const { data, error } = await supabase
        .from('printers')
        .insert(printerData)
        .select()
        .single();

      if (error) throw error;

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(data as DbPrinter);

      // Add to local state (the real-time subscription will also update this)
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
      const updateData = transformPrinterToDb(updates);
      
      const { data, error } = await supabase
        .from('printers')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Transform the returned data
      const transformedPrinter = transformPrinterFromDb(data as DbPrinter);

      // Note: We don't need to manually update state here because the real-time 
      // subscription will handle the update automatically
      
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
      const { error } = await supabase
        .from('printers')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      setPrinters(prev => prev.filter(p => p.id !== id));
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
      // Update sort_order for all printers in the new order
      const updates = reorderedPrinters.map((printer, index) => ({
        id: printer.id,
        sort_order: index + 1
      }));

      // Batch update all printers
      for (const update of updates) {
        const { error } = await supabase
          .from('printers')
          .update({ sort_order: update.sort_order })
          .eq('id', update.id);
        
        if (error) throw error;
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

  // Set up real-time subscription for printer changes
  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel('printer-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'printers',
          filter: `tenant_id=eq.${tenant.id}`
        },
        (payload) => {
          console.log('Printer updated via real-time:', payload);
          // Refetch printers when any printer is updated
          fetchPrinters();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id, fetchPrinters]);

  // Initial fetch
  useEffect(() => {
    if (tenant?.id) {
      fetchPrinters();
    }
  }, [tenant?.id, fetchPrinters]);

  return {
    printers,
    loading,
    addPrinter,
    updatePrinter,
    deletePrinter,
    updatePrintersOrder,
    refetch: fetchPrinters
  };
};
