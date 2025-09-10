import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type Tenant = {
  id: string;
  company_name: string;
  created_at: string;
  updated_at: string;
};

type Profile = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  role: string | null;
  is_active: boolean | null;
  last_login: string | null;
  created_at: string | null;
  updated_at: string | null;
};

interface TenantContextType {
  tenant: Tenant | null;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resetAuth: () => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const useTenantContext = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenantContext must be used within a TenantProvider');
  }
  return context;
};

interface TenantProviderProps {
  children: React.ReactNode;
}

export const TenantProvider: React.FC<TenantProviderProps> = ({ children }) => {
  console.log('=== TENANT PROVIDER RENDERING ===');
  
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resetAuth = useCallback(() => {
    console.log('TenantContext: Resetting authentication state');
    setProfile(null);
    setTenant(null);
    setError(null);
    setLoading(true);
  }, []);

  // Simple, reliable profile loading function
  const loadUserProfile = useCallback(async (userId: string) => {
    console.log('TenantContext: Loading profile for user:', userId);
    
    try {
      // Fetch profile with tenant data in one query - use maybeSingle to avoid errors
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select(`
          *,
          tenants (*)
        `)
        .eq('id', userId)
        .maybeSingle(); // Use maybeSingle instead of single to handle missing data gracefully

      if (profileError) {
        console.error('TenantContext: Profile query error:', profileError);
        if (profileError.code === 'PGRST116') {
          setError('Authentication failed. Please sign out and sign in again.');
        } else {
          setError('Failed to load user profile. Please try again.');
        }
        setLoading(false);
        return;
      }

      if (!profileData) {
        console.error('TenantContext: No profile found');
        setError('User profile not found. Please contact support.');
        setLoading(false);
        return;
      }

      console.log('TenantContext: Profile loaded successfully');
      setProfile(profileData);
      setTenant(profileData.tenants);
      setError(null);
      setLoading(false);
      
    } catch (error) {
      console.error('TenantContext: Unexpected error loading profile:', error);
      setError('An unexpected error occurred. Please sign out and sign in again.');
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      console.log('TenantContext: No user for refreshProfile');
      setProfile(null);
      setTenant(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    // Wait for auth context to be established
    setTimeout(() => {
      loadUserProfile(user.id);
    }, 500);
  }, [user, loadUserProfile]);

  useEffect(() => {
    console.log('TenantContext: Setting up auth listener');
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('TenantContext: Auth state changed:', event, session?.user?.id);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          console.log('TenantContext: User authenticated, loading profile');
          setLoading(true);
          setError(null);
          // Wait for auth context to be established, then load profile
          setTimeout(() => {
            loadUserProfile(session.user.id);
          }, 500);
        } else {
          console.log('TenantContext: No user, clearing all data');
          setProfile(null);
          setTenant(null);
          setLoading(false);
          setError(null);
        }
      }
    );

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('TenantContext: Initial session:', session?.user?.id || 'none');
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        console.log('TenantContext: Found existing session, loading profile');
        setLoading(true);
        setError(null);
        // Wait for auth context to be established, then load profile
        setTimeout(() => {
          loadUserProfile(session.user.id);
        }, 500);
      } else {
        console.log('TenantContext: No existing session');
        setLoading(false);
      }
    });

    return () => {
      console.log('TenantContext: Cleaning up auth listener');
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  const signIn = async (email: string, password: string) => {
    try {
      console.log('Attempting sign in for:', email);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Sign in error:', error);
        return { error };
      }

      console.log('Sign in successful for user:', data.user?.id);
      return { error: null };
    } catch (err) {
      console.error('Sign in exception:', err);
      return { error: err as Error };
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    try {
      // Use the complete-signup edge function which creates both user and tenant
      const { data, error } = await supabase.functions.invoke('complete-signup', {
        body: {
          email,
          password,
          firstName,
          lastName,
        },
      });

      if (error) {
        return { error };
      }

      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    console.log('TenantContext: Signing out');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setTenant(null);
    setError(null);
    setLoading(false);
  };

  return (
    <TenantContext.Provider
      value={{
        tenant,
        user,
        session,
        profile,
        loading,
        error,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        resetAuth,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};