import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShopifyConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShopifyConfig {
  configured: boolean;
  app_url: string | null;
  api_key_set: boolean;
  sync_active: boolean;
}

const ShopifyConnectModal = ({ isOpen, onClose }: ShopifyConnectModalProps) => {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shopifyConfig, setShopifyConfig] = useState<ShopifyConfig | null>(null);

  // Form state
  const [appUrl, setAppUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch tenant ID
      const tenantResponse = await fetch("/api/tenant/info");
      const tenantData = await tenantResponse.json();
      if (tenantData.tenant_id) {
        setTenantId(tenantData.tenant_id);
      }

      // Fetch Shopify config
      const configResponse = await fetch("/api/shopify/config");
      const configData = await configResponse.json();
      setShopifyConfig(configData);

      if (configData.app_url) {
        setAppUrl(configData.app_url);
      }

      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        title: "Error",
        description: "Failed to load configuration. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const maskTenantId = (id: string) => {
    if (!id) return "";
    const parts = id.split("-");
    if (parts.length === 5) {
      return `${parts[0]}-****-****-****-********${parts[4].slice(-4)}`;
    }
    return id;
  };

  const copyToClipboard = () => {
    // Check if Clipboard API is available (HTTPS/localhost only)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tenantId);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Tenant ID copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Fallback for HTTP contexts using execCommand
      const textArea = document.createElement("textarea");
      textArea.value = tenantId;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        setCopied(true);
        toast({
          title: "Copied!",
          description: "Tenant ID copied to clipboard",
        });
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        toast({
          title: "Copy failed",
          description: "Please copy manually",
          variant: "destructive",
        });
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  const handleSaveConfig = async () => {
    if (!appUrl.trim() || !apiKey.trim()) {
      toast({
        title: "Validation Error",
        description: "Please fill in both Shopify App URL and API Key",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/shopify/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_url: appUrl,
          api_key: apiKey,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to save configuration");
      }

      const data = await response.json();

      toast({
        title: "Success!",
        description: "Shopify configuration saved and sync service started",
      });

      // Refresh config
      await fetchData();

      // Clear API key field (security)
      setApiKey("");

    } catch (error) {
      console.error("Error saving config:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save configuration",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSync = async () => {
    try {
      const response = await fetch("/api/shopify/sync/manual", {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to trigger sync");
      }

      toast({
        title: "Success!",
        description: "Manual sync triggered successfully",
      });
    } catch (error) {
      console.error("Error triggering sync:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to trigger sync",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Connect to Shopify</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
              <p className="mt-4 text-muted-foreground">Loading configuration...</p>
            </div>
          ) : (
            <>
              {/* Status Badge */}
              {shopifyConfig?.configured && (
                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="font-semibold text-green-900 dark:text-green-100">
                        Shopify Connected
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        Sync service is {shopifyConfig.sync_active ? "active" : "inactive"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tenant ID Display */}
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Step 1: Get Your Tenant ID</h3>
                  <p className="text-sm text-muted-foreground">
                    Use this Tenant ID in the Shopify app to link your store
                  </p>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg border">
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-sm font-mono flex-1 break-all">
                      {maskTenantId(tenantId)}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyToClipboard}
                      className="shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Configuration Form */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Step 2: Configure Connection</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Enter your Shopify app details to enable order syncing
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="app_url">Shopify App URL</Label>
                    <Input
                      id="app_url"
                      type="url"
                      placeholder="https://your-app.vercel.app"
                      value={appUrl}
                      onChange={(e) => setAppUrl(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      The URL where your AutoPrintFarm Shopify app is deployed
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="api_key">API Key</Label>
                    <Input
                      id="api_key"
                      type="password"
                      placeholder="Enter API key from Shopify app"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Generate this in the Shopify app's "Devices" tab after connecting your tenant
                    </p>
                  </div>

                  <Button
                    onClick={handleSaveConfig}
                    disabled={saving || !appUrl.trim() || !apiKey.trim()}
                    className="w-full"
                  >
                    {saving ? "Saving..." : shopifyConfig?.configured ? "Update Configuration" : "Save Configuration"}
                  </Button>
                </div>
              </div>

              {/* Test Sync Button */}
              {shopifyConfig?.configured && (
                <div className="space-y-2">
                  <Button
                    onClick={handleTestSync}
                    variant="outline"
                    className="w-full"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Test Sync Now
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Manually trigger order sync to test the connection
                  </p>
                </div>
              )}

              {/* Instructions */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-lg font-semibold">Quick Setup Guide</h3>
                <ol className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="font-bold">1.</span>
                    <span>Copy your Tenant ID above</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">2.</span>
                    <span>Open your Shopify store → Apps → AutoPrintFarm → Devices tab</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">3.</span>
                    <span>Click "Connect Print Farm" and paste your Tenant ID</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">4.</span>
                    <span>Click "Add Device" to generate an API key</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">5.</span>
                    <span>Copy the API key and paste it above, then click Save Configuration</span>
                  </li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button onClick={onClose} variant="outline" className="flex-1">
                  Close
                </Button>
                <a
                  href="https://github.com/yourusername/autoprintfarm-docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button variant="secondary" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Documentation
                  </Button>
                </a>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShopifyConnectModal;
