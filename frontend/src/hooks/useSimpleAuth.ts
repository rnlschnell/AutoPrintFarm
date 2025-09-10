import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
}

export const useSimpleAuth = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const simpleSignup = async (data: SignupData) => {
    setLoading(true);
    
    try {
      // Generate a simple subdomain from company name
      const subdomain = data.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        + "-" + Date.now().toString(36);

      // Create tenant first
      let { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          company_name: data.companyName,
          subdomain: subdomain,
          is_active: true
        })
        .select("*")
        .single();

      if (tenantError) {
        // If subdomain already exists, try with a different one
        if (tenantError.code === "23505") { // Unique violation
          const altSubdomain = subdomain + "-" + Math.random().toString(36).substring(7);
          const { data: altTenantData, error: altTenantError } = await supabase
            .from("tenants")
            .insert({
              company_name: data.companyName,
              subdomain: altSubdomain,
              is_active: true
            })
            .select("*")
            .single();
          
          if (altTenantError) {
            throw new Error("Failed to create company account");
          }
          
          tenantData = altTenantData;
        } else {
          throw tenantError;
        }
      }

      // Sign up user with tenant_id in metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            first_name: data.firstName,
            last_name: data.lastName,
            tenant_id: tenantData.id
          }
        }
      });

      if (authError) {
        // Clean up tenant on failure
        await supabase.from("tenants").delete().eq("id", tenantData.id);
        throw authError;
      }

      // Create profile manually if trigger does not work
      if (authData.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .insert({
            id: authData.user.id,
            tenant_id: tenantData.id,
            email: data.email,
            first_name: data.firstName,
            last_name: data.lastName,
            role: "admin", // First user is admin
            is_active: true
          });

        if (profileError && profileError.code !== "23505") { // Ignore if already exists
          console.error("Profile creation error:", profileError);
        }
      }

      return { success: true, session: authData.session };
    } catch (error: any) {
      console.error("Signup error:", error);
      
      if (error.message?.includes("already registered")) {
        toast({
          title: "Account Already Exists",
          description: "An account with this email already exists. Please sign in instead.",
          variant: "destructive"
        });
        return { success: false, error: "USER_EXISTS" };
      }
      
      toast({
        title: "Signup Failed",
        description: error.message || "Failed to create account",
        variant: "destructive"
      });
      
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  return { simpleSignup, loading };
};
