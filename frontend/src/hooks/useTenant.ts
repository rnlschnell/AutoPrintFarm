import { useAuth } from "@/contexts/AuthContext";

export const useTenant = () => {
  const { tenantId } = useAuth();
  return { tenant: { id: tenantId }, tenantId };
};
