import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  role: string | null;
  tenant_id: string | null;
}

interface Tenant {
  id: string;
  company_name: string;
  subdomain?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  tenantId: string | null;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, firstName: string, lastName: string, companyName: string, subdomain?: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenant = async (tenantId: string, userMetadata: any) => {
    try {
      const { data: tenantData, error } = await supabase
        .from('tenants')
        .select('id, company_name, subdomain')
        .eq('id', tenantId)
        .single();

      if (tenantData && !error) {
        setTenant(tenantData);
      } else {
        // Fallback to metadata if database fetch fails
        setTenant({
          id: tenantId,
          company_name: userMetadata?.company_name || 'AutoPrintFarm',
          subdomain: null
        });
      }
    } catch (error) {
      console.error('Error fetching tenant:', error);
      // Fallback to metadata on error
      setTenant({
        id: tenantId,
        company_name: userMetadata?.company_name || 'AutoPrintFarm',
        subdomain: null
      });
    }
  };

  const fetchProfile = async (userId: string, userTenantId: string | null, userMetadata: any) => {
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileData && !error) {
        setProfile(profileData);
      } else {
        // Fallback to metadata if database fetch fails
        setProfile({
          id: userId,
          email: userMetadata?.email || '',
          first_name: userMetadata?.first_name || '',
          last_name: userMetadata?.last_name || null,
          role: userMetadata?.role || null,
          tenant_id: userTenantId
        });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      // Fallback to metadata on error
      setProfile({
        id: userId,
        email: userMetadata?.email || '',
        first_name: userMetadata?.first_name || '',
        last_name: userMetadata?.last_name || null,
        role: userMetadata?.role || null,
        tenant_id: userTenantId
      });
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      const userTenantId = session?.user?.user_metadata?.tenant_id ?? null;
      setTenantId(userTenantId);

      // Defer profile and tenant fetching to avoid deadlock
      if (session?.user) {
        setTimeout(() => {
          fetchProfile(session.user.id, userTenantId, session.user.user_metadata);

          // Fetch tenant details from database (including subdomain)
          if (userTenantId) {
            fetchTenant(userTenantId, session.user.user_metadata);
          }
        }, 0);
      } else {
        setProfile(null);
        setTenant(null);
      }

      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        const userTenantId = session?.user?.user_metadata?.tenant_id ?? null;
        setTenantId(userTenantId);

        // Defer profile and tenant fetching to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id, userTenantId, session.user.user_metadata);

            // Fetch tenant details from database (including subdomain)
            if (userTenantId) {
              fetchTenant(userTenantId, session.user.user_metadata);
            }
          }, 0);
        } else {
          setProfile(null);
          setTenant(null);
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      // Call Pi backend authentication endpoint to update tenant_config.yaml
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.detail || 'Login failed') };
      }

      // Backend has updated tenant_config.yaml, now authenticate with Supabase
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error };
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, companyName: string, subdomain?: string) => {
    try {
      // Call backend signup API endpoint
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          company_name: companyName,
          subdomain: subdomain || null  // Pass subdomain or null for auto-generation
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.detail || 'Signup failed') };
      }

      // Sign in after successful signup
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        return { error: signInError };
      }

      // Display success message with subdomain info
      if (data.subdomain) {
        console.log(`Account created successfully! Your domain: ${data.full_domain}`);
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    tenantId,
    profile,
    tenant,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};