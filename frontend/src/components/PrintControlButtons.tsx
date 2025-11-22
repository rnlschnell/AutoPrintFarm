import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pause, Play, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PrintControlButtonsProps {
  printerId: string;
  status: string;
  size?: "icon" | "sm" | "default";
  showLabel?: boolean;
}

const PrintControlButtons = ({
  printerId,
  status,
  size = "icon",
  showLabel = false
}: PrintControlButtonsProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Determine if we should show pause or resume
  const isPrinting = status === 'printing' || status === 'running' || status === 'RUNNING';
  const isPaused = status === 'paused' || status === 'PAUSE';

  // Don't show button if not printing or paused
  if (!isPrinting && !isPaused) {
    return null;
  }

  const handlePause = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/printers/${printerId}/print/pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to pause print');
      }

      toast({
        title: "Print paused",
        description: "The print job has been paused successfully",
      });
    } catch (error) {
      console.error('Error pausing print:', error);
      toast({
        title: "Error",
        description: "Failed to pause print job",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/printers/${printerId}/print/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to resume print');
      }

      toast({
        title: "Print resumed",
        description: "The print job has been resumed successfully",
      });
    } catch (error) {
      console.error('Error resuming print:', error);
      toast({
        title: "Error",
        description: "Failed to resume print job",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (isPaused) {
    return (
      <Button
        size={size}
        variant="ghost"
        onClick={handleResume}
        disabled={loading}
        className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
        title="Resume print"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            <Play className="h-3 w-3" />
            {showLabel && <span className="ml-1">Resume</span>}
          </>
        )}
      </Button>
    );
  }

  if (isPrinting) {
    return (
      <Button
        size={size}
        variant="ghost"
        onClick={handlePause}
        disabled={loading}
        className="h-6 w-6 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
        title="Pause print"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            <Pause className="h-3 w-3" />
            {showLabel && <span className="ml-1">Pause</span>}
          </>
        )}
      </Button>
    );
  }

  return null;
};

export default PrintControlButtons;
