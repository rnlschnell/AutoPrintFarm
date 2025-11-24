import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import FilamentColorTypeModal from "@/components/FilamentColorTypeModal";
import UserManagement from "@/components/auth/UserManagement";
import LogsManagement from "@/components/LogsManagement";
import BackupManagement from "@/components/BackupManagement";

const Settings = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);

  const handleSave = () => {
    toast({
      title: "Settings Updated",
      description: "Your settings have been successfully updated.",
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure your 3D printing management preferences.</p>
      </div>

      <Tabs defaultValue="general" className="space-y-8">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          {profile?.role === 'admin' && (
            <>
              <TabsTrigger value="logs">System Logs</TabsTrigger>
              <TabsTrigger value="users">User Management</TabsTrigger>
              <TabsTrigger value="backup">Backup & Restore</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="general" className="space-y-8">
          <div className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold mb-4">General Settings</h2>
            <p className="text-muted-foreground mb-6">Configure general preferences for your print farm.</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Filament Colors & Types */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Filament Colors & Types</Label>
                  <div className="text-sm text-muted-foreground mb-3">Manage the filament types and colors available for selection across the program. To add actual filament inventory, navigate to the Materials page.</div>
                  <Button
                    variant="outline"
                    onClick={() => setIsColorModalOpen(true)}
                    className="w-fit"
                  >
                    Manage Colors & Types
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold mb-4">Billing & Account</h2>
            <p className="text-muted-foreground mb-6">Manage your subscription, billing, and account details.</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Account Details */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Account Details</h3>
                  <p className="text-sm text-muted-foreground">View past invoices, change billing address, or manage current subscriptions.</p>
                  <Button variant="outline" className="w-fit">
                    Open Billing Portal
                  </Button>
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Payment Method</h3>
                  <p className="text-sm text-muted-foreground">Add new payment methods to your account.</p>
                  <Button variant="outline" className="w-fit">
                    Manage Payment Method
                  </Button>
                </div>
              </div>
            </div>

            {/* Current Usage */}
            <div className="mt-8 p-4 bg-muted/50 rounded-lg">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-medium">Current Printers</h3>
                  <p className="text-sm text-muted-foreground">Active printers on your plan</p>
                </div>
                <div className="text-2xl font-bold">1/∞</div>
              </div>
            </div>

            {/* Subscription Plans */}
            <div className="mt-8">
              <h3 className="text-lg font-medium mb-4">Subscription & Plans</h3>

              {/* Billing Toggle */}
              <div className="flex items-center justify-center mb-6">
                <span className="text-sm font-medium mr-3">Monthly</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    id="billing-toggle"
                    className="sr-only"
                    onChange={() => {}}
                  />
                  <label
                    htmlFor="billing-toggle"
                    className="flex items-center cursor-pointer"
                  >
                    <div className="relative">
                      <div className="block bg-muted w-14 h-8 rounded-full"></div>
                      <div className="dot absolute left-1 top-1 bg-background w-6 h-6 rounded-full transition"></div>
                    </div>
                  </label>
                </div>
                <span className="text-sm font-medium ml-3">Annual (Save up to 20%)</span>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-6">
                  <div className="text-center">
                    <h4 className="text-lg font-semibold mb-2">Monthly Plan</h4>
                    <div className="text-3xl font-bold mb-2">$29.99<span className="text-lg font-normal">/printer/mo</span></div>
                    <p className="text-sm text-muted-foreground mb-4">Billed monthly per printer</p>
                    <Button className="w-full">Current Plan</Button>
                  </div>
                </div>

                <div className="border rounded-lg p-6 relative">
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-medium">
                      Save 20%
                    </span>
                  </div>
                  <div className="text-center">
                    <h4 className="text-lg font-semibold mb-2">Annual Plan</h4>
                    <div className="text-3xl font-bold mb-2">$23.99<span className="text-lg font-normal">/printer/mo</span></div>
                    <p className="text-sm text-muted-foreground mb-4">Billed annually per printer</p>
                    <Button variant="outline" className="w-full">Switch to Annual</Button>
                  </div>
                </div>
              </div>

              {/* Extra Printers */}
              <div className="mt-8 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Extra Printers</h4>
                    <p className="text-sm text-muted-foreground">Add additional printers to your plan</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon">-</Button>
                    <span className="font-medium w-8 text-center">0</span>
                    <Button variant="outline" size="icon">+</Button>
                    <span className="text-sm text-muted-foreground ml-4">x $29.99/mo</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave}>Save Settings</Button>
          </div>
        </TabsContent>

        {profile?.role === 'admin' && (
          <>
            <TabsContent value="logs">
              <LogsManagement />
            </TabsContent>
            <TabsContent value="users">
              <UserManagement />
            </TabsContent>
            <TabsContent value="backup">
              <BackupManagement />
            </TabsContent>
          </>
        )}
      </Tabs>

      <FilamentColorTypeModal
        isOpen={isColorModalOpen}
        onClose={() => setIsColorModalOpen(false)}
      />
    </div>
  );
};

export default Settings;