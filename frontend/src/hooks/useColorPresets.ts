import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';

interface ColorPreset {
  id: string;
  color_name: string;
  hex_code: string;
  filament_type: string;
  is_active: boolean;
}

export const useColorPresets = () => {
  const [colorPresets, setColorPresets] = useState<ColorPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useTenant();
  const { toast } = useToast();

  const fetchColorPresets = async () => {
    if (!tenant?.id) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('color_presets')
        .select('*')
        .eq('tenant_id', tenant?.id)
        .eq('is_active', true)
        .order('color_name', { ascending: true });

      if (error) throw error;
      setColorPresets(data || []);
    } catch (error) {
      console.error('Error fetching color presets:', error);
    } finally {
      setLoading(false);
    }
  };

  const getColorHex = (colorName: string, filamentType?: string): string => {
    // First try to find exact match with filament type
    if (filamentType) {
      const exactMatch = colorPresets.find(
        preset => preset.color_name.toLowerCase() === colorName.toLowerCase() && 
                 preset.filament_type.toLowerCase() === filamentType.toLowerCase()
      );
      if (exactMatch) return exactMatch.hex_code;
    }

    // Fall back to any match with the color name
    const colorMatch = colorPresets.find(
      preset => preset.color_name.toLowerCase() === colorName.toLowerCase()
    );
    if (colorMatch) return colorMatch.hex_code;

    // Default fallback color
    return '#6b7280';
  };

  useEffect(() => {
    if (tenant?.id) {
      fetchColorPresets();
    }
  }, [tenant?.id]);

  const createColorPreset = async (colorName: string, hexCode: string, filamentType: string) => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { error } = await supabase
        .from('color_presets')
        .insert({
          color_name: colorName.trim(),
          hex_code: hexCode,
          filament_type: filamentType,
          tenant_id: tenant.id
        });

      if (error) throw error;

      toast({
        title: "Color Added",
        description: `${colorName} has been added to available colors.`,
      });
      
      await fetchColorPresets();
      return true;
    } catch (error) {
      console.error('Error creating color preset:', error);
      toast({
        title: "Error",
        description: "Failed to save color preset.",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateColorPreset = async (id: string, colorName: string, hexCode: string, filamentType: string) => {
    try {
      const { error } = await supabase
        .from('color_presets')
        .update({
          color_name: colorName.trim(),
          hex_code: hexCode,
          filament_type: filamentType
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Color Updated",
        description: "Color preset has been updated successfully.",
      });
      
      await fetchColorPresets();
      return true;
    } catch (error) {
      console.error('Error updating color preset:', error);
      toast({
        title: "Error",
        description: "Failed to update color preset.",
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteColorPreset = async (id: string) => {
    try {
      const { error } = await supabase
        .from('color_presets')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Color Removed",
        description: "Color preset has been removed.",
      });
      
      await fetchColorPresets();
      return true;
    } catch (error) {
      console.error('Error deleting color preset:', error);
      toast({
        title: "Error",
        description: "Failed to remove color preset.",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    colorPresets,
    loading,
    getColorHex,
    refetch: fetchColorPresets,
    createColorPreset,
    updateColorPreset,
    deleteColorPreset
  };
};