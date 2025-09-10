
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Palette } from "lucide-react";
import { HexColorPicker } from "react-colorful";

interface ColorPickerSectionProps {
  color: string;
  onColorChange: (color: string) => void;
}

const ColorPickerSection = ({ color, onColorChange }: ColorPickerSectionProps) => {
  const [selectedColor, setSelectedColor] = useState("#ff0000");
  const [colorName, setColorName] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleColorSelect = () => {
    if (colorName.trim()) {
      onColorChange(`${colorName.trim()}|${selectedColor}`);
      setShowColorPicker(false);
      setColorName("");
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <Input
          value={color.split('|')[0] || color}
          onChange={(e) => onColorChange(e.target.value)}
          placeholder="e.g. Red, Blue, Clear"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowColorPicker(!showColorPicker)}
        >
          <Palette className="h-4 w-4" />
        </Button>
      </div>
      {showColorPicker && (
        <div className="mt-2 p-3 border rounded-lg">
          <HexColorPicker color={selectedColor} onChange={setSelectedColor} />
          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Color name"
              value={colorName}
              onChange={(e) => setColorName(e.target.value)}
            />
            <Button size="sm" onClick={handleColorSelect}>Use Color</Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full border"
              style={{ backgroundColor: selectedColor }}
            />
            <span className="text-sm">{selectedColor}</span>
          </div>
        </div>
      )}
    </>
  );
};

export default ColorPickerSection;
