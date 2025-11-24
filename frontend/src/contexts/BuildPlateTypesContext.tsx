import React, { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';

interface BuildPlateType {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
}

interface BuildPlateTypesContextType {
  buildPlateTypes: BuildPlateType[];
  loading: boolean;
  refetch: () => void;
  createBuildPlateType: (name: string, description?: string) => Promise<boolean>;
  updateBuildPlateType: (id: string, name: string, description?: string) => Promise<boolean>;
  deleteBuildPlateType: (id: string) => Promise<boolean>;
}

const BuildPlateTypesContext = createContext<BuildPlateTypesContextType | undefined>(undefined);

// Global singleton state to prevent any duplicate requests
class BuildPlateTypesManager {
  private static instance: BuildPlateTypesManager;
  private fetchInProgress = false;
  private lastFetchTime = 0;
  // Cache keyed by tenant ID to prevent cross-tenant data leakage
  private cacheByTenant: Map<string, { data: BuildPlateType[], timestamp: number }> = new Map();
  private currentTenantId: string | null = null;
  private subscribers: Set<() => void> = new Set();
  private currentData: BuildPlateType[] = [];
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

  static getInstance(): BuildPlateTypesManager {
    if (!BuildPlateTypesManager.instance) {
      BuildPlateTypesManager.instance = new BuildPlateTypesManager();
    }
    return BuildPlateTypesManager.instance;
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
          console.error('Error in BuildPlateTypes subscriber callback:', error);
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

  async fetchBuildPlateTypes(tenantId: string, force: boolean = false): Promise<void> {
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

    // Check tenant-specific cache (60 second cache to prevent rapid refetches)
    const tenantCache = this.cacheByTenant.get(tenantId);
    if (!force && tenantCache && (now - tenantCache.timestamp) < 60000) {
      console.log('✅ Using cached build plate types for tenant:', tenantId);
      this.currentTenantId = tenantId;
      this.currentData = [...tenantCache.data]; // Copy to prevent mutations
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
    console.log('🚀 Starting global build plate types fetch');
    this.fetchInProgress = true;
    this.lastFetchTime = now;
    this.isLoading = true;
    this.notifySubscribers();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout to 15 seconds

      const response = await fetch('/api/build-plate-types/', {
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

      // Filter for active build plate types and sort by name
      const activeBuildPlates = data
        .filter((buildPlate: BuildPlateType) => buildPlate?.is_active && buildPlate?.id && buildPlate?.name)
        .sort((a: BuildPlateType, b: BuildPlateType) => a.name.localeCompare(b.name));

      // Success - reset error count and update tenant-specific cache
      this.errorCount = 0;
      this.circuitBreakerOpen = false;
      this.backoffDelay = 1000; // Reset backoff on success
      this.cacheByTenant.set(tenantId, { data: activeBuildPlates, timestamp: now });
      this.currentTenantId = tenantId;
      this.currentData = activeBuildPlates;
      console.log(`✅ Build plate types fetch complete for tenant ${tenantId}: ${activeBuildPlates.length} types`);

    } catch (error) {
      this.errorCount++;
      this.lastError = now;

      console.error(`❌ Global build plate types fetch error (${this.errorCount}/3):`, error);

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

  // Clear all caches - called on signOut/switchTenant to prevent cross-tenant data leakage
  clearCache(): void {
    this.cacheByTenant.clear();
    this.currentTenantId = null;
    this.currentData = [];
    this.activeRequests.clear();
    this.strictModeGuard.clear();
    this.notifySubscribers();
    console.log('🧹 BuildPlateTypes cache cleared');
  }
}

/** Clear the build plate types cache - call on signOut/switchTenant */
export const clearBuildPlateTypesCache = (): void => {
  BuildPlateTypesManager.getInstance().clearCache();
};

export const BuildPlateTypesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { tenant, isInitialized } = useTenant();
  const { toast } = useToast();

  // Use useRef to maintain stable reference to manager and prevent stale closures
  const managerRef = useRef<BuildPlateTypesManager>();
  if (!managerRef.current) {
    managerRef.current = BuildPlateTypesManager.getInstance();
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
    manager.fetchBuildPlateTypes(tenantId);
  }, []);

  useEffect(() => {
    // Wait for auth to be fully initialized before making API calls
    // This prevents race conditions where tenant ID isn't set in the API client yet
    if (!isInitialized) {
      return;
    }
    if (tenant?.id) {
      fetchData(tenant.id);
    }
  }, [tenant?.id, isInitialized, fetchData]);

  const createBuildPlateType = useCallback(async (name: string, description?: string) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      const response = await fetch('/api/build-plate-types/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description?.trim() || null,
          is_active: true
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create build plate type: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to create build plate type');
      }

      toast({
        title: "Build Plate Added",
        description: `${name} has been added to available build plates.`,
      });

      await managerRef.current!.fetchBuildPlateTypes(tenant.id, true); // Force refresh after create
      return true;
    } catch (error) {
      console.error('Error creating build plate type:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save build plate type.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const updateBuildPlateType = useCallback(async (id: string, name: string, description?: string) => {
    try {
      const response = await fetch(`/api/build-plate-types/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description?.trim() || null
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update build plate type: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to update build plate type');
      }

      toast({
        title: "Build Plate Updated",
        description: "Build plate type has been updated successfully.",
      });

      await managerRef.current!.fetchBuildPlateTypes(tenant?.id || '', true); // Force refresh after update
      return true;
    } catch (error) {
      console.error('Error updating build plate type:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update build plate type.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const deleteBuildPlateType = useCallback(async (id: string) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      const response = await fetch(`/api/build-plate-types/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete build plate type: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to delete build plate type');
      }

      toast({
        title: "Build Plate Removed",
        description: "Build plate type has been permanently deleted.",
      });

      await managerRef.current!.fetchBuildPlateTypes(tenant.id, true); // Force refresh after delete
      return true;
    } catch (error) {
      console.error('Error deleting build plate type:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove build plate type. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  }, [tenant?.id, toast]);

  const contextValue: BuildPlateTypesContextType = {
    buildPlateTypes: localState.data,
    loading: localState.loading,
    refetch: () => managerRef.current!.fetchBuildPlateTypes(tenant?.id || '', true),
    createBuildPlateType,
    updateBuildPlateType,
    deleteBuildPlateType
  };

  return (
    <BuildPlateTypesContext.Provider value={contextValue}>
      {children}
    </BuildPlateTypesContext.Provider>
  );
};

export const useBuildPlateTypesContext = () => {
  const context = useContext(BuildPlateTypesContext);
  if (!context) {
    throw new Error('useBuildPlateTypesContext must be used within a BuildPlateTypesProvider');
  }
  return context;
};
