/**
 * Hub Management Hook
 *
 * Provides CRUD operations for ESP32 hubs and integrates with
 * real-time hub status from the dashboard WebSocket.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import type { Hub } from '@/types/api';
import { useDashboardWebSocket, type DashboardHubStatus } from './useDashboardWebSocket';

// =============================================================================
// TYPES
// =============================================================================

export interface HubWithLiveStatus extends Hub {
  liveStatus?: DashboardHubStatus;
}

interface UseHubsReturn {
  hubs: HubWithLiveStatus[];
  loading: boolean;
  error: string | null;
  hubToken: string | null;

  // CRUD operations
  fetchHubs: () => Promise<void>;
  getHub: (hubId: string) => Promise<Hub | null>;
  updateHub: (hubId: string, updates: Partial<Hub>) => Promise<Hub | null>;
  claimHub: (hubId: string, claimCode: string, name?: string) => Promise<Hub | null>;
  releaseHub: (hubId: string) => Promise<boolean>;

  // Hub token for BLE setup
  fetchHubToken: () => Promise<string | null>;
  regenerateHubToken: () => Promise<string | null>;
}

// =============================================================================
// HOOK
// =============================================================================

export const useHubs = (): UseHubsReturn => {
  const { tenantId, isInitialized } = useAuth();
  const { toast } = useToast();
  const { hubStatuses } = useDashboardWebSocket();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hubToken, setHubToken] = useState<string | null>(null);

  /**
   * Fetch all hubs for the current tenant
   */
  const fetchHubs = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await api.get<Hub[]>('/api/v1/hubs');
      setHubs(Array.isArray(response) ? response : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch hubs';
      setError(message);
      console.error('[useHubs] Failed to fetch hubs:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  /**
   * Get a single hub by ID
   */
  const getHub = useCallback(async (hubId: string): Promise<Hub | null> => {
    try {
      const response = await api.get<Hub>(`/api/v1/hubs/${hubId}`);
      return response;
    } catch (err) {
      console.error('[useHubs] Failed to get hub:', err);
      toast({
        title: 'Error',
        description: 'Failed to get hub details',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  /**
   * Update hub details (name, etc.)
   */
  const updateHub = useCallback(async (hubId: string, updates: Partial<Hub>): Promise<Hub | null> => {
    try {
      const response = await api.put<Hub>(`/api/v1/hubs/${hubId}`, updates);

      // Update local state
      setHubs(prev => prev.map(h => h.id === hubId ? { ...h, ...response } : h));

      toast({
        title: 'Hub Updated',
        description: 'Hub settings have been saved.',
      });

      return response;
    } catch (err) {
      console.error('[useHubs] Failed to update hub:', err);
      toast({
        title: 'Error',
        description: 'Failed to update hub',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  /**
   * Claim an unclaimed hub
   */
  const claimHub = useCallback(async (hubId: string, claimCode: string, name?: string): Promise<Hub | null> => {
    try {
      const response = await api.post<Hub>('/api/v1/hubs/claim', {
        hub_id: hubId,
        claim_code: claimCode,
        name: name || `Hub ${hubId.slice(-6)}`,
      });

      // Add to local state
      setHubs(prev => [...prev, response]);

      toast({
        title: 'Hub Claimed',
        description: `${response.name || hubId} has been added to your tenant.`,
      });

      return response;
    } catch (err) {
      console.error('[useHubs] Failed to claim hub:', err);
      toast({
        title: 'Error',
        description: 'Failed to claim hub. Please check the claim code.',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  /**
   * Release a hub (remove from tenant)
   */
  const releaseHub = useCallback(async (hubId: string): Promise<boolean> => {
    try {
      await api.delete(`/api/v1/hubs/${hubId}`);

      // Remove from local state
      setHubs(prev => prev.filter(h => h.id !== hubId));

      toast({
        title: 'Hub Released',
        description: 'Hub has been removed from your tenant.',
      });

      return true;
    } catch (err) {
      console.error('[useHubs] Failed to release hub:', err);
      toast({
        title: 'Error',
        description: 'Failed to release hub',
        variant: 'destructive',
      });
      return false;
    }
  }, [toast]);

  /**
   * Fetch the hub claim token for BLE setup
   */
  const fetchHubToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await api.get<{ token: string }>('/api/v1/tenants/hub-token');
      setHubToken(response.token);
      return response.token;
    } catch (err) {
      console.error('[useHubs] Failed to fetch hub token:', err);
      toast({
        title: 'Error',
        description: 'Failed to get hub claim token',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  /**
   * Regenerate the hub claim token (invalidates old token)
   */
  const regenerateHubToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await api.post<{ token: string }>('/api/v1/tenants/hub-token/regenerate');
      setHubToken(response.token);

      toast({
        title: 'Token Regenerated',
        description: 'A new hub claim token has been generated. Old tokens are now invalid.',
      });

      return response.token;
    } catch (err) {
      console.error('[useHubs] Failed to regenerate hub token:', err);
      toast({
        title: 'Error',
        description: 'Failed to regenerate hub token',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  // Fetch hubs when tenant is ready
  useEffect(() => {
    if (isInitialized && tenantId) {
      fetchHubs();
    }
  }, [isInitialized, tenantId, fetchHubs]);

  // Merge hubs with live status from WebSocket
  const hubsWithLiveStatus: HubWithLiveStatus[] = hubs.map(hub => ({
    ...hub,
    liveStatus: hubStatuses.get(hub.id),
  }));

  return {
    hubs: hubsWithLiveStatus,
    loading,
    error,
    hubToken,
    fetchHubs,
    getHub,
    updateHub,
    claimHub,
    releaseHub,
    fetchHubToken,
    regenerateHubToken,
  };
};

export default useHubs;
