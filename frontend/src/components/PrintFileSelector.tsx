import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAvailableFiles, type AvailableFile } from "@/hooks/useAvailableFiles";
import { FileText, HardDrive, Clock } from "lucide-react";

interface PrintFileSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

const PrintFileSelector = ({ value, onValueChange, disabled = false }: PrintFileSelectorProps) => {
  const { printFiles, loading } = useAvailableFiles();

  const formatFileSize = (sizeBytes: number): string => {
    if (sizeBytes < 1024 * 1024) {
      return `${Math.round(sizeBytes / 1024)} KB`;
    }
    return `${Math.round(sizeBytes / (1024 * 1024) * 10) / 10} MB`;
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="print-file">Print File *</Label>
      <Select 
        value={value} 
        onValueChange={onValueChange}
        disabled={disabled || loading}
      >
        <SelectTrigger id="print-file">
          <SelectValue 
            placeholder={
              loading 
                ? "Loading files from Pi..." 
                : printFiles.length === 0 
                  ? "No files available on Pi"
                  : "Select print file"
            } 
          />
        </SelectTrigger>
        <SelectContent>
          {printFiles.length === 0 && !loading && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              <span>No 3MF files found on Pi</span>
            </div>
          )}
          {printFiles.map((file: AvailableFile) => (
            <SelectItem key={file.id} value={file.id}>
              <div className="flex items-start gap-2 w-full">
                <FileText className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {file.filename.replace('.3mf', '')}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatFileSize(file.size_bytes)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(file.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {printFiles.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {printFiles.length} file{printFiles.length !== 1 ? 's' : ''} available on Pi
        </p>
      )}
      
      {printFiles.length === 0 && !loading && (
        <p className="text-xs text-orange-600">
          No 3MF files found on Pi. Upload files through the Products page first.
        </p>
      )}
    </div>
  );
};

export default PrintFileSelector;