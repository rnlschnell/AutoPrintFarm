import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { logsService } from "@/services/logsService";
import { useAuth } from "@/contexts/AuthContext";

const LogsManagement = () => {
  const { toast } = useToast();
  const { tenant } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [lastDownload, setLastDownload] = useState<string | null>(null);

  useEffect(() => {
    const savedLastDownload = localStorage.getItem("lastLogDownload");
    if (savedLastDownload) {
      setLastDownload(savedLastDownload);
    }
  }, []);

  const handleDownload = async () => {
    try {
      setIsLoading(true);

      await logsService.downloadLogs(tenant?.company_name);

      const now = new Date().toISOString();
      setLastDownload(now);
      localStorage.setItem("lastLogDownload", now);

      toast({
        title: "Logs Downloaded",
        description: "System logs have been downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download logs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return "N/A";
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            System Logs Management
          </CardTitle>
          <CardDescription>
            Download system logs for debugging and support purposes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Download Section */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <p className="font-medium">Download Logs Archive</p>
                <p className="text-sm text-muted-foreground">
                  Downloads all system logs as a ZIP file including application logs, system logs, and diagnostics
                </p>
                {lastDownload && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last downloaded: {formatDate(lastDownload)}
                  </p>
                )}
              </div>
              <Button
                onClick={handleDownload}
                disabled={isLoading}
                className="w-full sm:w-auto"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Download Logs
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Info Section */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The log archive includes application logs, error logs, and system information/diagnostics.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
};

export default LogsManagement;