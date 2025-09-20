import React, { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';

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

// Global singleton state to prevent any duplicate requests
class ColorPresetsManager {
  private static instance: ColorPresetsManager;
  private fetchInProgress = false;
  private lastFetchTime = 0;
  private cache: { data: ColorPreset[], timestamp: number } | null = null;
  private subscribers: Set<() => void> = new Set();
  private currentData: ColorPreset[] = [];
  private isLoading = false;
  private circuitBreakerOpen = false;
  private errorCount = 0;
  private lastError = 0;
  // Request deduplication with unique keys
  private activeRequests: Map<string, Promise<void>> = new Map();
  // React Strict Mode protection
  private strictModeGuard: Set<string> = new Set();
  // Exponential backoff for rate limiting
  private backoffDelay = 1000; // Start with 1 second

  static getInstance(): ColorPresetsManager {
    if (!ColorPresetsManager.instance) {
      ColorPresetsManager.instance = new ColorPresetsManager();
    }
    return ColorPresetsManager.instance;
  }

  subscribe(callback: () => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notifySubscribers() {
    // Use setTimeout to prevent synchronous updates that could cause loops
    setTimeout(() => {
      this.subscribers.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('Error in ColorPresets subscriber callback:', error);
        }
      });
    }, 0);
  }

  getData() {
    return {
      data: [...this.currentData], // Return a copy to prevent mutations
      loading: this.isLoading
    };
  }

  // React Strict Mode protection - prevents duplicate calls in development
  private strictModeProtection(tenantId: string, force: boolean): boolean {
    if (process.env.NODE_ENV === 'development') {
      const key = `${tenantId}_${force}`;
      if (this.strictModeGuard.has(key)) {
        console.log('🛡️ React Strict Mode duplicate call blocked');
        return true; // Block this call
      }
      this.strictModeGuard.add(key);
      // Clear the guard after a short delay
      setTimeout(() => this.strictModeGuard.delete(key), 100);
    }
    return false; // Allow the call
  }

  async fetchColorPresets(tenantId: string, force: boolean = false): Promise<void> {
    if (!tenantId) return;

    // React Strict Mode protection
    if (this.strictModeProtection(tenantId, force)) return;

    // Request deduplication with unique keys
    const requestKey = `${tenantId}_${force}`;
    if (this.activeRequests.has(requestKey)) {
      console.log(`🔗 Request already in flight for key: ${requestKey}, returning existing promise`);
      return this.activeRequests.get(requestKey);
    }
    
    // Circuit breaker - stop all requests if we're in failure mode
    const now = Date.now();
    if (this.circuitBreakerOpen) {
      // Stay open for 5 minutes after errors, with exponential backoff
      const breakerDuration = Math.min(300000, this.backoffDelay * Math.pow(2, this.errorCount - 3));
      if (now - this.lastError < breakerDuration) {
        console.log(`🚫 CIRCUIT BREAKER OPEN - All requests blocked for ${Math.round(breakerDuration / 1000)}s`);
        return;
      } else {
        // Try to reset circuit breaker
        console.log('🔄 Attempting to reset circuit breaker');
        this.circuitBreakerOpen = false;
        this.errorCount = 0;
        this.backoffDelay = 1000; // Reset backoff
      }
    }
    
    // Global deduplication - prevent ANY duplicate requests across all components
    if (this.fetchInProgress) {
      console.log('🛑 Global fetch already in progress, blocking duplicate request');
      return;
    }
    
    // Check global cache (60 second cache to prevent rapid refetches)
    if (!force && this.cache && (now - this.cache.timestamp) < 60000) {
      console.log('✅ Using global cached color presets');
      this.currentData = [...this.cache.data]; // Copy to prevent mutations
      this.isLoading = false;
      this.notifySubscribers();
      return;
    }
    
    // Global debounce (minimum 5 seconds between fetches)
    if (!force && (now - this.lastFetchTime) < 5000) {
      console.log('🕐 Global debounce blocking request');
      return;
    }

    // Create and store the request promise
    const requestPromise = this.performFetch(tenantId, now);
    this.activeRequests.set(requestKey, requestPromise);

    try {
      await requestPromise;
    } finally {
      // Always clean up the active request
      this.activeRequests.delete(requestKey);
    }
  }

  private async performFetch(tenantId: string, now: number): Promise<void> {
    console.log('🚀 Starting global color presets fetch');
    this.fetchInProgress = true;
    this.lastFetchTime = now;
    this.isLoading = true;
    this.notifySubscribers();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout to 15 seconds
      
      const response = await fetch('/api/color-presets/', {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 429) {
        // Rate limited - apply exponential backoff
        this.backoffDelay = Math.min(30000, this.backoffDelay * 2);
        throw new Error(`Rate limited - backing off for ${this.backoffDelay}ms`);
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Validate response data
      if (!Array.isArray(data)) {
        throw new Error('Invalid response format - expected array');
      }
      
      // Filter for active presets and sort by color name
      const activePresets = data
        .filter((preset: ColorPreset) => preset?.is_active && preset?.id && preset?.color_name)
        .sort((a: ColorPreset, b: ColorPreset) => a.color_name.localeCompare(b.color_name));
      
      // Success - reset error count and update cache
      this.errorCount = 0;
      this.circuitBreakerOpen = false;
      this.backoffDelay = 1000; // Reset backoff on success
      this.cache = { data: activePresets, timestamp: now };
      this.currentData = activePresets;
      console.log(`✅ Global color presets fetch complete: ${activePresets.length} presets`);
      
    } catch (error) {
      this.errorCount++;
      this.lastError = now;
      
      console.error(`❌ Global color presets fetch error (${this.errorCount}/3):`, error);
      
      // Open circuit breaker after 3 errors
      if (this.errorCount >= 3) {
        this.circuitBreakerOpen = true;
        this.backoffDelay = Math.min(30000, this.backoffDelay * 2);
        console.error(`🚫 CIRCUIT BREAKER OPENED - Stopping requests for ${this.backoffDelay}ms`);
      }
      
      // Keep existing data on error, don't clear it
    } finally {
      this.isLoading = false;
      this.fetchInProgress = false;
      this.notifySubscribers();
    }
  }

  // Add method to clear cache for testing
  clearCache(): void {
    this.cache = null;
    this.activeRequests.clear();
    this.strictModeGuard.clear();
    console.log('🧹 ColorPresets cache cleared');
  }
}

export const ColorPresetsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  
  // Use useRef to maintain stable reference to manager and prevent stale closures
  const managerRef = useRef<ColorPresetsManager>();
  if (!managerRef.current) {
    managerRef.current = ColorPresetsManager.getInstance();
  }
  
  // Local state that gets updated by the singleton manager
  const [localState, setLocalState] = useState(() => managerRef.current!.getData());

  // Subscribe to singleton updates - no dependencies to prevent stale closures
  useEffect(() => {
    const manager = managerRef.current!;
    const unsubscribe = manager.subscribe(() => {
      setLocalState(manager.getData());
    });
    return unsubscribe;
  }, []); // Empty dependency array to prevent re-subscriptions

  // Fetch data when tenant changes - use useCallback to prevent stale closures
  const fetchData = useCallback((tenantId: string) => {
    const manager = managerRef.current!;
    manager.fetchColorPresets(tenantId);
  }, []);

  useEffect(() => {
    if (tenant?.id) {
      fetchData(tenant.id);
    }
  }, [tenant?.id, fetchData]);

  const getColorHex = useCallback((colorName: string, filamentType?: string): string => {
    // First try to find exact match with filament type
    if (filamentType) {
      const exactMatch = localState.data.find(
        preset => preset.color_name.toLowerCase() === colorName.toLowerCase() && 
                 preset.filament_type.toLowerCase() === filamentType.toLowerCase()
      );
      if (exactMatch) return exactMatch.hex_code;
    }

    // Fall back to any match with the color name
    const colorMatch = localState.data.find(
      preset => preset.color_name.toLowerCase() === colorName.toLowerCase()
    );
    if (colorMatch) return colorMatch.hex_code;

    // Default fallback color
    return '#6b7280';
  }, [localState.data]);

  const createColorPreset = useCallback(async (colorName: string, hexCode: string, filamentType: string) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      const response = await fetch('/api/color-presets/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          color_name: colorName.trim(),
          hex_code: hexCode,
          material_type: filamentType,
          is_active: true
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create color preset: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to create color preset');
      }

      toast({
        title: "Color Added",
        description: `${colorName} has been added to available colors.`,
      });
      
      await managerRef.current!.fetchColorPresets(tenant.id, true); // Force refresh after create
      return true;
    } catch (error) {
      console.error('Error creating color preset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save color preset.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const updateColorPreset = useCallback(async (id: string, colorName: string, hexCode: string, filamentType: string) => {
    try {
      const response = await fetch(`/api/color-presets/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          color_name: colorName.trim(),
          hex_code: hexCode,
          material_type: filamentType
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update color preset: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to update color preset');
      }

      toast({
        title: "Color Updated",
        description: "Color preset has been updated successfully.",
      });
      
      await managerRef.current!.fetchColorPresets(tenant?.id || '', true); // Force refresh after update
      return true;
    } catch (error) {
      console.error('Error updating color preset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update color preset.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const deleteColorPreset = useCallback(async (id: string) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      const response = await fetch(`/api/color-presets/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete color preset: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to delete color preset');
      }

      toast({
        title: "Color Removed",
        description: "Color preset has been permanently deleted.",
      });
      
      await managerRef.current!.fetchColorPresets(tenant.id, true); // Force refresh after delete
      return true;
    } catch (error) {
      console.error('Error deleting color preset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove color preset. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const contextValue: ColorPresetsContextType = {
    colorPresets: localState.data,
    loading: localState.loading,
    getColorHex,
    refetch: () => managerRef.current!.fetchColorPresets(tenant?.id || '', true),
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