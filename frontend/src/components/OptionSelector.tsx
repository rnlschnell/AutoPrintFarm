import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface OptionSelectorProps {
  value: 'print_file' | 'product';
  onValueChange: (value: 'print_file' | 'product') => void;
  disabled?: boolean;
}

const OptionSelector = ({ value, onValueChange, disabled = false }: OptionSelectorProps) => {
  return (
    <div className="space-y-2">
      <Label>Job Type *</Label>
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={value === 'print_file' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onValueChange('print_file')}
          disabled={disabled}
          className="h-8 flex-1"
        >
          Print File
        </Button>
        <Button
          type="button"
          variant={value === 'product' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onValueChange('product')}
          disabled={disabled}
          className="h-8 flex-1"
        >
          Product
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value === 'print_file' 
          ? 'Select from available 3MF files stored on Pi'
          : 'Select from configured products with linked files'
        }
      </p>
    </div>
  );
};

export default OptionSelector;