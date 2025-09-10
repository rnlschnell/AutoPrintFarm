
import { cn } from "@/lib/utils";
import { useColorPresets } from "@/hooks/useColorPresets";

interface ColorSwatchProps {
  color: string;
  filamentType?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const ColorSwatch = ({ color, filamentType, size = 'sm', className }: ColorSwatchProps) => {
  const { getColorHex } = useColorPresets();

  const getColorValue = (colorName: string) => {
    // Check if color has custom hex value (format: "colorname|#hexvalue")
    if (colorName && colorName.includes('|')) {
      const parts = colorName.split('|');
      return parts[1]; // Return the hex value
    }
    
    // Check for direct hex values
    if (colorName && colorName.startsWith('#')) {
      return colorName;
    }
    
    // Use color presets from database
    return getColorHex(colorName, filamentType);
  };

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  const displayColor = color.split('|')[0] || color; // Show just the name for title

  return (
    <div
      className={cn(
        'rounded-full border border-gray-300 flex-shrink-0',
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: getColorValue(color) }}
      title={displayColor}
    />
  );
};

export default ColorSwatch;
