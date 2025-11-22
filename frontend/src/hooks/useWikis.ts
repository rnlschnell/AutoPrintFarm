import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';

export interface WikiSection {
  id: string;
  type: 'subtitle' | 'step' | 'note' | 'warning';
  order: number;
  content?: string;
  title?: string;
  description?: string;
  image_url?: string;
  notes?: string;
  warnings?: string[];
  number?: number;
}

export interface Wiki {
  id: string;
  tenant_id: string;
  title: string;
  description?: string;
  estimated_time_minutes?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  tools_required?: string[];
  sections: WikiSection[];
  product_id?: string | null;
  sku_id?: string | null;
  created_at: string;
  updated_at: string;
}

export const useWikis = () => {
  const [wikis, setWikis] = useState<Wiki[]>([]);
  const [loading, setLoading] = useState(false);
  const { tenantId } = useTenant();
  const { toast } = useToast();

  const fetchWikis = useCallback(async () => {
    if (!tenantId) {
      console.warn('No tenant ID available');
      return [];
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('product_wikis')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      setWikis(data || []);
      return data || [];
    } catch (error: any) {
      console.error('Error fetching wikis:', error);
      toast({
        title: 'Error',
        description: `Failed to fetch wikis: ${error.message}`,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  const getWiki = useCallback(async (id: string): Promise<Wiki | null> => {
    if (!tenantId) {
      console.warn('No tenant ID available');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('product_wikis')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error) throw error;

      return data;
    } catch (error: any) {
      console.error('Error fetching wiki:', error);
      toast({
        title: 'Error',
        description: `Failed to fetch wiki: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [tenantId, toast]);

  const createWiki = useCallback(async (wikiData: Partial<Wiki>): Promise<Wiki | null> => {
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant ID available',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('product_wikis')
        .insert({
          ...wikiData,
          tenant_id: tenantId,
          sections: wikiData.sections || [],
          tools_required: wikiData.tools_required || [],
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Wiki created successfully',
      });

      await fetchWikis();
      return data;
    } catch (error: any) {
      console.error('Error creating wiki:', error);
      toast({
        title: 'Error',
        description: `Failed to create wiki: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [tenantId, toast, fetchWikis]);

  const updateWiki = useCallback(async (id: string, updates: Partial<Wiki>): Promise<Wiki | null> => {
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant ID available',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('product_wikis')
        .update(updates)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Wiki updated successfully',
      });

      await fetchWikis();
      return data;
    } catch (error: any) {
      console.error('Error updating wiki:', error);
      toast({
        title: 'Error',
        description: `Failed to update wiki: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [tenantId, toast, fetchWikis]);

  const deleteWiki = useCallback(async (id: string): Promise<boolean> => {
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant ID available',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const { error } = await supabase
        .from('product_wikis')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Wiki deleted successfully',
      });

      await fetchWikis();
      return true;
    } catch (error: any) {
      console.error('Error deleting wiki:', error);
      toast({
        title: 'Error',
        description: `Failed to delete wiki: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    }
  }, [tenantId, toast, fetchWikis]);

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload a JPG, PNG, GIF, or WebP image',
          variant: 'destructive',
        });
        return null;
      }

      // Validate file size (5MB max)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: 'Please upload an image smaller than 5MB',
          variant: 'destructive',
        });
        return null;
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from('wiki-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('wiki-images')
        .getPublicUrl(fileName);

      toast({
        title: 'Success',
        description: 'Image uploaded successfully',
      });

      return publicUrl;
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast({
        title: 'Error',
        description: `Failed to upload image: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  const getWikiByProductSku = useCallback(async (sku: string): Promise<Wiki | null> => {
    if (!tenantId) {
      console.warn('No tenant ID available');
      return null;
    }

    try {
      // Try to find wiki by SKU first
      const { data: skuData, error: skuError } = await supabase
        .from('product_skus')
        .select('id, product_id')
        .eq('sku', sku)
        .eq('tenant_id', tenantId)
        .single();

      if (skuError) {
        console.warn('SKU not found:', skuError);
        return null;
      }

      // First try to find wiki by sku_id
      const { data: wikiBySkuId, error: wikiSkuError } = await supabase
        .from('product_wikis')
        .select('*')
        .eq('sku_id', skuData.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (wikiBySkuId) {
        return wikiBySkuId;
      }

      // Fallback: try to find wiki by product_id
      if (skuData.product_id) {
        const { data: wikiByProductId, error: wikiProductError } = await supabase
          .from('product_wikis')
          .select('*')
          .eq('product_id', skuData.product_id)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (wikiByProductId) {
          return wikiByProductId;
        }
      }

      // No wiki found
      return null;
    } catch (error: any) {
      console.error('Error fetching wiki by SKU:', error);
      return null;
    }
  }, [tenantId]);

  return {
    wikis,
    loading,
    fetchWikis,
    getWiki,
    getWikiByProductSku,
    createWiki,
    updateWiki,
    deleteWiki,
    uploadImage,
  };
};
