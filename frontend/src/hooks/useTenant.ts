import { useAuth } from "@/contexts/AuthContext";

/**
 * Convenience hook for accessing tenant information from AuthContext.
 * Provides backwards compatibility for components using the old useTenant pattern.
 */
export const useTenant = () => {
  const { tenantId, tenant, tenants, switchTenant } = useAuth();

  return {
    tenant,
    tenantId,
    tenants,
    switchTenant
  };
};
