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
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  tenantId: string | null;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, firstName: string, lastName: string, companyName: string) => Promise<{ error: any }>;
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
      
      // Set tenant from metadata
      if (userTenantId) {
        setTenant({
          id: userTenantId,
          company_name: session?.user?.user_metadata?.company_name || 'PrintFlow'
        });
      } else {
        setTenant(null);
      }
      
      // Defer profile fetching to avoid deadlock
      if (session?.user) {
        setTimeout(() => {
          fetchProfile(session.user.id, userTenantId, session.user.user_metadata);
        }, 0);
      } else {
        setProfile(null);
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
        
        // Set tenant from metadata
        if (userTenantId) {
          setTenant({
            id: userTenantId,
            company_name: session?.user?.user_metadata?.company_name || 'PrintFlow'
          });
        } else {
          setTenant(null);
        }
        
        // Defer profile fetching to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id, userTenantId, session.user.user_metadata);
          }, 0);
        } else {
          setProfile(null);
        }
        
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, companyName: string) => {
    try {
      // Generate a simple subdomain from company name
      const subdomain = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        + "-" + Date.now().toString(36);

      // Create tenant first
      const { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          company_name: companyName,
          subdomain: subdomain,
          is_active: true
        })
        .select("*")
        .single();

      if (tenantError) {
        // If subdomain already exists, try with a different one
        if (tenantError.code === "23505") {
          const altSubdomain = subdomain + "-" + Math.random().toString(36).substring(7);
          const { data: altTenantData, error: altTenantError } = await supabase
            .from("tenants")
            .insert({
              company_name: companyName,
              subdomain: altSubdomain,
              is_active: true
            })
            .select("*")
            .single();
          
          if (altTenantError) {
            return { error: new Error("Failed to create company account") };
          }
          
          tenantData.id = altTenantData.id;
        } else {
          return { error: tenantError };
        }
      }

      // Sign up user with tenant_id in metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            tenant_id: tenantData.id,
            company_name: companyName,
            role: "admin"
          }
        }
      });

      if (authError) {
        // Clean up tenant on failure
        await supabase.from("tenants").delete().eq("id", tenantData.id);
        return { error: authError };
      }

      // Create profile manually if trigger does not work
      if (authData.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .insert({
            id: authData.user.id,
            tenant_id: tenantData.id,
            email: email,
            first_name: firstName,
            last_name: lastName,
            role: "admin",
            is_active: true
          });

        if (profileError && profileError.code !== "23505") {
          console.error("Profile creation error:", profileError);
        }
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