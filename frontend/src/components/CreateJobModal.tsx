
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import ColorSwatch from "@/components/ColorSwatch";
import { useColorPresetsContext } from "@/contexts/ColorPresetsContext";
import { usePrintFiles } from "@/hooks/usePrintFiles";
import { usePrinters } from "@/hooks/usePrinters";
import { useTenant } from "@/hooks/useTenant";

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateJob: (jobData: {
    printFileId: string;
    fileName: string;
    color: string;
    filamentType: string;
    materialType: string;
    printerId?: string;
    numberOfUnits: number;
  }) => void;
}

const CreateJobModal = ({ isOpen, onClose, onCreateJob }: CreateJobModalProps) => {
  const [jobData, setJobData] = useState({
    printFileId: '',
    printerId: '',
    color: '',
    copies: '1'
  });
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { colorPresets } = useColorPresetsContext();
  const { printFiles, loading: filesLoading } = usePrintFiles();
  const { printers, loading: printersLoading } = usePrinters();

  const handleCreateJob = () => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "You must be logged in to create print jobs.",
        variant: "destructive",
      });
      return;
    }

    if (!jobData.printFileId || !jobData.color) {
      toast({
        title: "Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const selectedFile = printFiles.find(f => f.id === jobData.printFileId);
    if (!selectedFile) {
      toast({
        title: "Error",
        description: "Selected print file not found.",
        variant: "destructive",
      });
      return;
    }

    // Parse color and filament type from color preset
    const [colorName, hexCode] = jobData.color.split('|');
    const selectedColorPreset = colorPresets.find(p => 
      p.color_name === colorName && p.hex_code === hexCode
    );
    
    if (!selectedColorPreset) {
      toast({
        title: "Error",
        description: "Selected color preset not found.",
        variant: "destructive",
      });
      return;
    }

    const createJobData = {
      printFileId: jobData.printFileId,
      fileName: selectedFile.name,
      color: jobData.color,
      filamentType: selectedColorPreset.filament_type,
      materialType: selectedColorPreset.filament_type, // Using filament_type as material_type
      printerId: jobData.printerId === "any" ? undefined : jobData.printerId || undefined,
      numberOfUnits: parseInt(jobData.copies)
    };

    onCreateJob(createJobData);
    setJobData({
      printFileId: '',
      printerId: '',
      color: '',
      copies: '1'
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Print Job</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="file">Print File *</Label>
              <Select 
                value={jobData.printFileId} 
                onValueChange={(value) => setJobData({ ...jobData, printFileId: value })}
                disabled={filesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filesLoading ? "Loading files..." : "Select file"} />
                </SelectTrigger>
                <SelectContent>
                  {printFiles.map((file) => (
                    <SelectItem key={file.id} value={file.id}>
                      {file.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="printer">Printer (Optional)</Label>
              <Select 
                value={jobData.printerId} 
                onValueChange={(value) => setJobData({ ...jobData, printerId: value })}
                disabled={printersLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={printersLoading ? "Loading printers..." : "Any Printer"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any Printer</SelectItem>
                  {printers.map((printer) => (
                    <SelectItem key={printer.id} value={printer.id}>
                      {printer.name} ({printer.model})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Filament Color *</Label>
            <Select value={jobData.color} onValueChange={(value) => setJobData({ ...jobData, color: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select color" />
              </SelectTrigger>
              <SelectContent>
                {colorPresets.map((preset) => (
                  <SelectItem key={preset.id} value={`${preset.color_name}|${preset.hex_code}`}>
                    <div className="flex items-center gap-2">
                      <ColorSwatch color={`${preset.color_name}|${preset.hex_code}`} size="sm" />
                      <span>{preset.color_name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="copies">Copies</Label>
            <Input
              id="copies"
              type="number"
              min="1"
              value={jobData.copies}
              onChange={(e) => setJobData({ ...jobData, copies: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleCreateJob}
            disabled={!tenant?.id || filesLoading || printersLoading}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateJobModal;
