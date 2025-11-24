import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authClient, type AuthSession, type RegisterResponse } from '@/lib/auth-client';
import { api, setCurrentTenantId } from '@/lib/api-client';
import type { User, Tenant, TenantMember } from '@/types/api';
import { clearColorPresetsCache } from '@/contexts/ColorPresetsContext';
import { clearBuildPlateTypesCache } from '@/contexts/BuildPlateTypesContext';

// =============================================================================
// TYPES
// =============================================================================

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string | null;
  tenant_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: AuthSession['session'] | null;
  tenantId: string | null;
  profile: Profile | null;
  tenant: Tenant | null;
  tenants: Tenant[];
  loading: boolean;
  /** True when auth and tenant context are fully initialized and ready for API calls */
  isInitialized: boolean;
  /** Critical auth error that requires user action (e.g., tenant creation failed) */
  authError: string | null;
  /** Clear the auth error */
  clearAuthError: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, firstName: string, lastName: string, companyName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// =============================================================================
// PROVIDER
// =============================================================================

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession['session'] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * Clear auth error
   */
  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  /**
   * Fetch user's tenants from the API
   */
  const fetchTenants = useCallback(async (): Promise<Tenant[]> => {
    try {
      // Backend returns { success: true, data: tenants[] }
      // api.get unwraps to return just the data, which is the array
      const response = await api.get<Tenant[]>('/api/v1/tenants');
      return Array.isArray(response) ? response : [];
    } catch (error) {
      console.error('Error fetching tenants:', error);
      return [];
    }
  }, []);

  /**
   * Fetch single tenant details
   */
  const fetchTenant = useCallback(async (id: string): Promise<Tenant | null> => {
    try {
      const response = await api.get<Tenant>(`/api/v1/tenants/${id}`);
      return response;
    } catch (error) {
      console.error('Error fetching tenant:', error);
      return null;
    }
  }, []);

  /**
   * Fetch tenant membership to get user's role
   */
  const fetchMembership = useCallback(async (tenantIdToFetch: string, userId: string): Promise<TenantMember | null> => {
    try {
      // Backend returns { success: true, data: members[] }
      // api.get unwraps to return just the data, which is the array
      const response = await api.get<TenantMember[]>(`/api/v1/tenants/${tenantIdToFetch}/members`);
      const members = Array.isArray(response) ? response : [];
      const member = members.find(m => m.user_id === userId);
      return member || null;
    } catch (error) {
      console.error('Error fetching membership:', error);
      return null;
    }
  }, []);

  /**
   * Ensure user has a tenant - creates one if they don't have any
   * This is a fallback for users who existed before atomic registration was implemented.
   * New users registered via /register always have a tenant.
   */
  const ensureTenant = useCallback(async (): Promise<Tenant | null> => {
    try {
      console.warn('[Auth] User has no tenants - this should only happen for legacy users');
      const response = await api.post<Tenant>('/api/v1/tenants/ensure', {});
      return response;
    } catch (error) {
      console.error('Error ensuring tenant:', error);
      return null;
    }
  }, []);

  /**
   * Initialize auth state from session
   * This is called on app load and after sign-in.
   *
   * For NEW users: Registration via /register guarantees they have a tenant.
   * For EXISTING users: They should already have a tenant. If not, ensureTenant is a fallback.
   */
  const initializeAuth = useCallback(async (authSession: AuthSession) => {
    if (authSession.user && authSession.session) {
      setUser(authSession.user);
      setSession(authSession.session);

      // Fetch user's tenants
      const userTenants = await fetchTenants();
      setTenants(userTenants);

      // Get stored tenant ID or use first tenant
      const storedTenantId = localStorage.getItem('printfarm_tenant_id');
      let selectedTenantId = storedTenantId;

      // Validate stored tenant ID is in user's tenants
      if (storedTenantId && !userTenants.find(t => t.id === storedTenantId)) {
        // Stored tenant is invalid (user removed from it, etc.)
        localStorage.removeItem('printfarm_tenant_id');
        selectedTenantId = null;
      }

      // Default to first tenant if no valid stored tenant
      if (!selectedTenantId && userTenants.length > 0) {
        selectedTenantId = userTenants[0].id;
      }

      if (selectedTenantId) {
        // CRITICAL: Set tenant ID in API client FIRST, before any state updates
        // This ensures the tenant ID is available for any API calls triggered by re-renders
        setCurrentTenantId(selectedTenantId);
        localStorage.setItem('printfarm_tenant_id', selectedTenantId);

        // Now set React state
        setTenantId(selectedTenantId);

        // Fetch tenant details
        const tenantDetails = await fetchTenant(selectedTenantId);
        if (tenantDetails) {
          setTenant(tenantDetails);
        }

        // Fetch membership for role
        const membership = await fetchMembership(selectedTenantId, authSession.user.id);

        // Build profile from user and membership
        setProfile({
          id: authSession.user.id,
          email: authSession.user.email,
          full_name: authSession.user.full_name,
          role: membership?.role || null,
          tenant_id: selectedTenantId,
        });

        // Mark as fully initialized - tenant context is ready for API calls
        setIsInitialized(true);
      } else {
        // Edge case: User has no tenants
        // This should NOT happen for users registered via /register
        // But it's a fallback for legacy users or data corruption
        const ensuredTenant = await ensureTenant();

        if (ensuredTenant) {
          // CRITICAL: Set tenant ID in API client FIRST, before any state updates
          setCurrentTenantId(ensuredTenant.id);
          localStorage.setItem('printfarm_tenant_id', ensuredTenant.id);

          // Now set React state
          setTenantId(ensuredTenant.id);
          setTenant(ensuredTenant);
          setTenants([ensuredTenant]);

          setProfile({
            id: authSession.user.id,
            email: authSession.user.email,
            full_name: authSession.user.full_name,
            role: 'owner', // User who creates tenant is always owner
            tenant_id: ensuredTenant.id,
          });

          // Mark as fully initialized
          setIsInitialized(true);
        } else {
          // Critical error: Cannot create tenant for user
          // This is a fatal state - user cannot use the app
          // Sign out the user and show error message
          console.error('[Auth] CRITICAL: Failed to ensure tenant for user. Forcing sign out.');

          // Clear all state
          setUser(null);
          setSession(null);
          setTenantId(null);
          setTenant(null);
          setTenants([]);
          setProfile(null);
          setIsInitialized(false);
          setCurrentTenantId(null);
          localStorage.removeItem('printfarm_tenant_id');

          // Try to sign out on server
          try {
            await authClient.signOut();
          } catch {
            // Ignore sign out errors
          }

          // Set user-facing error message
          setAuthError(
            'Account setup failed: Unable to create your organization. ' +
            'Please try signing up again or contact support if the problem persists.'
          );
        }
      }
    } else {
      // No session - clear everything
      setUser(null);
      setSession(null);
      setTenantId(null);
      setTenant(null);
      setTenants([]);
      setProfile(null);
      setIsInitialized(false);
      setCurrentTenantId(null);
    }
  }, [fetchTenants, fetchTenant, fetchMembership, ensureTenant]);

  /**
   * Get initial session on mount
   */
  useEffect(() => {
    const getInitialSession = async () => {
      try {
        const result = await authClient.getSession();
        if (result.data) {
          await initializeAuth(result.data);
        }
      } catch (error) {
        console.error('Error getting initial session:', error);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();
  }, [initializeAuth]);

  /**
   * Sign in with email and password
   */
  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    try {
      const result = await authClient.signIn({ email, password });

      if (result.error) {
        return { error: new Error(result.error.message) };
      }

      if (result.data) {
        await initializeAuth(result.data);
      }

      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Sign in failed') };
    }
  };

  /**
   * Sign up with email, password, and profile info
   * Uses the atomic /register endpoint that creates user + tenant together.
   * This guarantees every user has exactly one tenant - no race conditions.
   */
  const signUp = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    companyName: string
  ): Promise<{ error: Error | null }> => {
    try {
      // Use the atomic register endpoint
      const result = await authClient.register({
        email,
        password,
        name: `${firstName} ${lastName}`.trim(),
        company_name: companyName || undefined,
      });

      if (result.error) {
        return { error: new Error(result.error.message) };
      }

      if (result.data) {
        // The register response includes user, session, and tenant
        // Set everything directly - no need to fetch anything
        const { user: regUser, session: regSession, tenant: regTenant } = result.data;

        // CRITICAL: Set tenant ID in API client FIRST, before ANY React state updates
        // This ensures the tenant ID is available for any API calls triggered by child component re-renders
        setCurrentTenantId(regTenant.id);
        localStorage.setItem('printfarm_tenant_id', regTenant.id);

        // Transform to our User type
        const transformedUser: User = {
          id: regUser.id,
          email: regUser.email,
          full_name: regUser.name,
          is_active: 1,
          last_login: null,
          created_at: regUser.createdAt,
          updated_at: regUser.updatedAt,
        };

        // Set tenant directly from response
        const tenantData: Tenant = {
          id: regTenant.id,
          subdomain: regTenant.subdomain,
          company_name: regTenant.company_name,
          is_active: 1,
          role: regTenant.role,
        };

        // Now set all React state together
        setUser(transformedUser);
        setSession({
          id: regSession.id,
          userId: regSession.userId,
          expiresAt: regSession.expiresAt,
          user: transformedUser,
        });
        setTenantId(regTenant.id);
        setTenant(tenantData);
        setTenants([tenantData]);

        // Set profile
        setProfile({
          id: regUser.id,
          email: regUser.email,
          full_name: regUser.name,
          role: regTenant.role,
          tenant_id: regTenant.id,
        });

        // Mark as fully initialized - tenant context is ready for API calls
        setIsInitialized(true);
      }

      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Sign up failed') };
    }
  };

  /**
   * Sign out the current user
   */
  const signOut = async (): Promise<void> => {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      // Clear all caches to prevent cross-tenant data leakage
      clearColorPresetsCache();
      clearBuildPlateTypesCache();

      // Clear state regardless of API result
      setUser(null);
      setSession(null);
      setTenantId(null);
      setTenant(null);
      setTenants([]);
      setProfile(null);
      setIsInitialized(false);
      setCurrentTenantId(null);
      localStorage.removeItem('printfarm_tenant_id');
    }
  };

  /**
   * Switch to a different tenant
   */
  const switchTenant = async (newTenantId: string): Promise<void> => {
    // Validate tenant is in user's tenants
    const targetTenant = tenants.find(t => t.id === newTenantId);
    if (!targetTenant) {
      throw new Error('Invalid tenant');
    }

    // Clear all caches to prevent cross-tenant data leakage
    clearColorPresetsCache();
    clearBuildPlateTypesCache();

    // CRITICAL: Set tenant ID in API client FIRST, before any state updates
    setCurrentTenantId(newTenantId);
    localStorage.setItem('printfarm_tenant_id', newTenantId);

    // Now set React state
    setTenantId(newTenantId);
    setTenant(targetTenant);

    // Update profile with new tenant and role
    if (user) {
      const membership = await fetchMembership(newTenantId, user.id);
      if (profile) {
        setProfile({
          ...profile,
          tenant_id: newTenantId,
          role: membership?.role || null,
        });
      }
    }
  };

  /**
   * Refresh the current session
   */
  const refreshSession = async (): Promise<void> => {
    try {
      const result = await authClient.getSession();
      if (result.data) {
        await initializeAuth(result.data);
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
    }
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  const value: AuthContextType = {
    user,
    session,
    tenantId,
    profile,
    tenant,
    tenants,
    loading,
    isInitialized,
    authError,
    clearAuthError,
    signIn,
    signUp,
    signOut,
    switchTenant,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
