import React, { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api-client';
import type { ColorPreset as ApiColorPreset, ListResponse } from '@/types/api';

interface ColorPreset {
  id: string;
  color_name: string;
  hex_code: string;
  filament_type: string;
  is_active: boolean;
}

interface ColorPresetsContextType {
  colorPresets: ColorPreset[];
  loading: boolean;
  getColorHex: (colorName: string, filamentType?: string) => string;
  refetch: () => void;
  createColorPreset: (colorName: string, hexCode: string, filamentType: string) => Promise<boolean>;
  updateColorPreset: (id: string, colorName: string, hexCode: string, filamentType: string) => Promise<boolean>;
  deleteColorPreset: (id: string) => Promise<boolean>;
}

const ColorPresetsContext = createContext<ColorPresetsContextType | undefined>(undefined);

// Cache for color presets - keyed by tenant ID to prevent cross-tenant data leakage
const presetCache: Map<string, { presets: ColorPreset[]; timestamp: number }> = new Map();
const CACHE_TTL = 60000; // 60 seconds

/** Clear the color presets cache - call on signOut/switchTenant */
export const clearColorPresetsCache = (): void => {
  presetCache.clear();
  console.log('🧹 ColorPresets cache cleared');
};

export const ColorPresetsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { tenantId, isInitialized } = useAuth();
  const { toast } = useToast();
  const [colorPresets, setColorPresets] = useState<ColorPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchInProgress = useRef(false);

  const fetchColorPresets = useCallback(async (force: boolean = false) => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    // Check tenant-specific cache
    const now = Date.now();
    const cached = presetCache.get(tenantId);
    if (!force && cached && cached.presets.length > 0 && (now - cached.timestamp) < CACHE_TTL) {
      setColorPresets(cached.presets);
      setLoading(false);
      return;
    }

    // Prevent duplicate fetches
    if (fetchInProgress.current) return;
    fetchInProgress.current = true;

    try {
      const response = await api.get<ListResponse<ApiColorPreset>>('/api/v1/colors', {
        params: { limit: 200 }
      });

      if (!response?.items) {
        throw new Error('Invalid response from server');
      }

      // Transform to local format
      const presets: ColorPreset[] = response.items
        .filter(preset => preset.is_active === 1)
        .map(preset => ({
          id: preset.id,
          color_name: preset.color_name,
          hex_code: preset.hex_code,
          filament_type: preset.filament_type,
          is_active: true
        }))
        .sort((a, b) => a.color_name.localeCompare(b.color_name));

      // Update tenant-specific cache
      presetCache.set(tenantId, { presets, timestamp: now });

      setColorPresets(presets);
    } catch (error) {
      console.error('Error fetching color presets:', error);
      if (!(error instanceof ApiError && error.isAuthError())) {
        toast({
          title: "Error",
          description: "Failed to load color presets.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  }, [tenantId, toast]);

  useEffect(() => {
    // Wait for auth to be fully initialized before making API calls
    // This prevents race conditions where tenant ID isn't set in the API client yet
    if (!isInitialized) {
      return;
    }

    if (tenantId) {
      // Clear presets immediately when tenant changes to avoid showing stale data
      setColorPresets([]);
      setLoading(true);
      fetchColorPresets();
    } else {
      // No tenant - clear everything
      setColorPresets([]);
      setLoading(false);
    }
  }, [tenantId, isInitialized, fetchColorPresets]);

  const getColorHex = useCallback((colorName: string, filamentType?: string): string => {
    // First try to find exact match with filament type
    if (filamentType) {
      const exactMatch = colorPresets.find(
        preset => preset.color_name.toLowerCase() === colorName.toLowerCase() &&
          preset.filament_type.toLowerCase() === filamentType.toLowerCase()
      );
      if (exactMatch) return exactMatch.hex_code;
    }

    // Fall back to any match with the color name
    const colorMatch = colorPresets.find(
      preset => preset.color_name.toLowerCase() === colorName.toLowerCase()
    );
    if (colorMatch) return colorMatch.hex_code;

    // Default fallback color
    return '#6b7280';
  }, [colorPresets]);

  const createColorPreset = useCallback(async (colorName: string, hexCode: string, filamentType: string) => {
    if (!tenantId) {
      toast({
        title: "Error",
        description: "No tenant selected. Please refresh the page and try again.",
        variant: "destructive",
      });
      return false;
    }

    try {
      await api.post<ApiColorPreset>('/api/v1/colors', {
        color_name: colorName.trim(),
        hex_code: hexCode,
        filament_type: filamentType,
        is_active: 1
      });

      toast({
        title: "Color Added",
        description: `${colorName} has been added to available colors.`,
      });

      // Refresh from server
      await fetchColorPresets(true);
      return true;
    } catch (error) {
      console.error('Error creating color preset:', error);
      const message = error instanceof ApiError
        ? (error.isAuthError() ? "Session expired. Please sign in again." : error.message)
        : (error instanceof Error ? error.message : "Failed to save color preset.");
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  }, [tenantId, toast, fetchColorPresets]);

  const updateColorPreset = useCallback(async (id: string, colorName: string, hexCode: string, filamentType: string) => {
    if (!tenantId) {
      toast({
        title: "Error",
        description: "No tenant selected. Please refresh the page and try again.",
        variant: "destructive",
      });
      return false;
    }

    try {
      await api.put<ApiColorPreset>(`/api/v1/colors/${id}`, {
        color_name: colorName.trim(),
        hex_code: hexCode,
        filament_type: filamentType
      });

      toast({
        title: "Color Updated",
        description: "Color preset has been updated successfully.",
      });

      // Refresh from server
      await fetchColorPresets(true);
      return true;
    } catch (error) {
      console.error('Error updating color preset:', error);
      const message = error instanceof ApiError
        ? (error.isAuthError() ? "Session expired. Please sign in again." : error.message)
        : (error instanceof Error ? error.message : "Failed to update color preset.");
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  }, [tenantId, toast, fetchColorPresets]);

  const deleteColorPreset = useCallback(async (id: string) => {
    if (!tenantId) {
      toast({
        title: "Error",
        description: "No tenant selected. Please refresh the page and try again.",
        variant: "destructive",
      });
      return false;
    }

    try {
      await api.delete(`/api/v1/colors/${id}`);

      toast({
        title: "Color Removed",
        description: "Color preset has been permanently deleted.",
      });

      // Refresh from server
      await fetchColorPresets(true);
      return true;
    } catch (error) {
      console.error('Error deleting color preset:', error);
      const message = error instanceof ApiError
        ? (error.isAuthError() ? "Session expired. Please sign in again." : error.message)
        : (error instanceof Error ? error.message : "Failed to remove color preset.");
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  }, [tenantId, toast, fetchColorPresets]);

  const contextValue: ColorPresetsContextType = {
    colorPresets,
    loading,
    getColorHex,
    refetch: () => fetchColorPresets(true),
    createColorPreset,
    updateColorPreset,
    deleteColorPreset
  };

  return (
    <ColorPresetsContext.Provider value={contextValue}>
      {children}
    </ColorPresetsContext.Provider>
  );
};

export const useColorPresetsContext = () => {
  const context = useContext(ColorPresetsContext);
  if (!context) {
    throw new Error('useColorPresetsContext must be used within a ColorPresetsProvider');
  }
  return context;
};
