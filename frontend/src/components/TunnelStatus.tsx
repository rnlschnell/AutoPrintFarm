import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Globe, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface TunnelStatusData {
  active: boolean;
  tunnel_id: string | null;
  subdomain: string | null;
  full_domain: string | null;
  process_pid: number | null;
  config_exists: boolean;
  credentials_exist: boolean;
}

const TunnelStatus = () => {
  const { tenant, session } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<TunnelStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);

  const fetchTunnelStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/tunnel/status');

      if (!response.ok) {
        throw new Error('Failed to fetch tunnel status');
      }

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Error fetching tunnel status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleProvisionTunnel = async () => {
    try {
      setProvisioning(true);
      setError(null);

      // Get user's Supabase access token
      if (!session?.access_token) {
        throw new Error('You must be logged in to activate remote access');
      }

      console.log('Session object:', session);
      console.log('Access token (first 50 chars):', session.access_token.substring(0, 50));

      const response = await fetch('/api/tunnel/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || errorData.message || 'Failed to provision tunnel');
      }

      const data = await response.json();
      console.log('Tunnel provisioned:', data);

      // Refresh status immediately
      await fetchTunnelStatus();
    } catch (err) {
      console.error('Error provisioning tunnel:', err);
      setError(err instanceof Error ? err.message : 'Failed to provision tunnel');
    } finally {
      setProvisioning(false);
    }
  };

  const startTunnel = async () => {
    try {
      setToggling(true);
      const response = await fetch('/api/tunnel/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || errorData.message || 'Failed to start tunnel');
      }

      const data = await response.json();

      toast({
        title: "Tunnel Started",
        description: "Remote access is now active",
      });

      // Refresh status immediately
      await fetchTunnelStatus();
    } catch (err) {
      console.error('Error starting tunnel:', err);
      toast({
        title: "Failed to Start Tunnel",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  };

  const stopTunnel = async () => {
    try {
      setToggling(true);
      const response = await fetch('/api/tunnel/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || errorData.message || 'Failed to stop tunnel');
      }

      const data = await response.json();

      toast({
        title: "Tunnel Stopped",
        description: "Remote access has been disabled",
      });

      // Refresh status immediately
      await fetchTunnelStatus();
    } catch (err) {
      console.error('Error stopping tunnel:', err);
      toast({
        title: "Failed to Stop Tunnel",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  };

  const handleTunnelToggle = (checked: boolean) => {
    if (checked) {
      // Starting the tunnel - do it immediately
      startTunnel();
    } else {
      // Stopping the tunnel - show confirmation dialog
      setShowStopDialog(true);
    }
  };

  const handleStopConfirm = () => {
    setShowStopDialog(false);
    stopTunnel();
  };

  const handleStopCancel = () => {
    setShowStopDialog(false);
  };

  useEffect(() => {
    fetchTunnelStatus();

    // Poll status every 30 seconds
    const interval = setInterval(fetchTunnelStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!tenant) {
    return null;
  }

  // Get subdomain from tenant or status
  const subdomain = status?.subdomain || (tenant as any).subdomain;
  const fullDomain = status?.full_domain || (subdomain ? `${subdomain}.autoprintfarm.com` : null);
  const tunnelActive = status?.active || false;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <CardTitle>Remote Access</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={tunnelActive ? "default" : "secondary"}>
              {tunnelActive ? "Active" : "Inactive"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchTunnelStatus}
              disabled={loading}
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <CardDescription>
          Access your print farm from anywhere
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-sm text-destructive">
            Error loading tunnel status: {error}
          </div>
        ) : loading && !status ? (
          <div className="text-sm text-muted-foreground">
            Loading tunnel status...
          </div>
        ) : fullDomain ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              Your Remote URL:
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://${fullDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-primary hover:underline flex items-center gap-1"
              >
                {fullDomain}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {!tunnelActive && status?.credentials_exist && (
              <p className="text-xs text-muted-foreground mt-2">
                Tunnel configured but not running. It will start automatically after login.
              </p>
            )}
            {!tunnelActive && !status?.credentials_exist && (
              <div className="mt-4">
                <Button
                  onClick={handleProvisionTunnel}
                  disabled={provisioning}
                  size="sm"
                >
                  {provisioning ? 'Activating...' : 'Activate Remote Access'}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Click to set up your secure remote connection
                </p>
              </div>
            )}
            {tunnelActive && status?.process_pid && (
              <p className="text-xs text-muted-foreground mt-2">
                Connected remotely (PID: {status.process_pid})
              </p>
            )}

            {/* Tunnel Toggle - only show if credentials exist */}
            {status?.credentials_exist && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="tunnel-toggle" className="text-sm font-medium">
                      Remote Access Control
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Turn remote access on or off
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {toggling && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Switch
                      id="tunnel-toggle"
                      checked={tunnelActive}
                      onCheckedChange={handleTunnelToggle}
                      disabled={loading || toggling || provisioning}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No subdomain configured. Remote access is not available yet.
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog for Stopping Tunnel */}
      <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn Off Remote Access?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to turn off remote access? Your subdomain will become unreachable until you turn it back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStopCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStopConfirm}>Turn Off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default TunnelStatus;
