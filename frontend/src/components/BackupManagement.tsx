import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, Database, AlertCircle, Loader2, FileText, Shield, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { backupService } from "@/services/backupService";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";

interface DatabaseInfo {
  database_size_mb: number;
  total_records: number;
  tables: Record<string, number>;
  last_modified: string;
  backup_directory: string;
}

const BackupManagement = () => {
  const { toast } = useToast();
  const { tenant } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);
  const [createBackupBeforeRestore, setCreateBackupBeforeRestore] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    loadDatabaseInfo();
    const savedLastBackup = localStorage.getItem("lastBackupDownload");
    if (savedLastBackup) {
      setLastBackup(savedLastBackup);
    }
  }, []);

  const loadDatabaseInfo = async () => {
    try {
      setIsLoadingInfo(true);
      const info = await backupService.getDatabaseInfo();
      setDbInfo(info);
    } catch (error) {
      console.error("Failed to load database info:", error);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      setIsDownloading(true);

      await backupService.downloadBackup(tenant?.company_name);

      const now = new Date().toISOString();
      setLastBackup(now);
      localStorage.setItem("lastBackupDownload", now);

      toast({
        title: "Backup Downloaded",
        description: "Complete database backup has been downloaded successfully.",
      });

      await loadDatabaseInfo();
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download backup",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileSelect = (file: File) => {
    if (file) {
      // Validate file type
      const validExtensions = ['.tar', '.db', '.gz'];
      const hasValidExtension = validExtensions.some(ext =>
        file.name.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        toast({
          title: "Invalid File Type",
          description: "Please select a valid backup file (.tar, .db, or .gz)",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedFile) {
      toast({
        title: "No File Selected",
        description: "Please select a backup file to restore",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUploading(true);

      const result = await backupService.restoreBackup(selectedFile, createBackupBeforeRestore);

      toast({
        title: "Restore Successful",
        description: result.message,
      });

      // Clear selected file and reload info
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await loadDatabaseInfo();

    } catch (error) {
      toast({
        title: "Restore Failed",
        description: error instanceof Error ? error.message : "Failed to restore backup",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
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

  const formatFileSize = (mb: number) => {
    if (mb < 1) {
      return `${(mb * 1024).toFixed(2)} KB`;
    }
    return `${mb.toFixed(2)} MB`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Download Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download Backup
          </CardTitle>
          <CardDescription>
            Create and download a complete backup of your database and print files
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <p className="font-medium">Create Complete Backup</p>
              <p className="text-sm text-muted-foreground">
                Downloads all database records and print files as a compressed archive
              </p>
              {lastBackup && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last downloaded: {formatDate(lastBackup)}
                </p>
              )}
            </div>
            <Button
              onClick={handleDownloadBackup}
              disabled={isDownloading}
              className="w-full sm:w-auto"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating backup...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download Backup
                </>
              )}
            </Button>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              All products, finished goods, skus, print files, printers, print jobs, and worklist tasks.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Restore Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Restore Backup
          </CardTitle>
          <CardDescription>
            Upload and restore a backup file to replace current data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : selectedFile
                ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                : 'border-muted-foreground/25'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {selectedFile ? (
              <div className="space-y-2">
                <FileText className="h-8 w-8 text-green-500 mx-auto" />
                <p className="font-medium text-green-700 dark:text-green-400">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  Remove file
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                <div>
                  <p className="text-sm font-medium">Drop backup file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports .tar, .db, and .gz backup files
                  </p>
                </div>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Browse Files
                </Button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar,.db,.gz"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>

          {/* Restore Options */}
          <div className="flex items-center space-x-2">
            <Switch
              id="create-backup"
              checked={createBackupBeforeRestore}
              onCheckedChange={setCreateBackupBeforeRestore}
            />
            <Label htmlFor="create-backup" className="text-sm">
              Create backup before restoring (recommended)
            </Label>
          </div>

          {/* Restore Button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={!selectedFile || isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Restore Backup
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-destructive" />
                  Confirm Backup Restore
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace all current data with the contents of the backup file.
                  {createBackupBeforeRestore && " A backup of current data will be created first."}
                  <br/><br/>
                  <strong>This action cannot be undone.</strong> Are you sure you want to continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestoreBackup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Restore Backup
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Warning */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> Restoring a backup will replace all current database records and files.
              This action is irreversible. Ensure you have a recent backup before proceeding.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
};

export default BackupManagement;