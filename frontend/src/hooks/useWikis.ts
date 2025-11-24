import { useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api-client';
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
  // Additional fields from cloud API
  slug?: string;
  content?: string;
  excerpt?: string;
  category?: string;
  tags?: string[];
  is_published?: boolean;
}

interface CreateWikiData {
  title: string;
  description?: string;
  estimated_time_minutes?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  tools_required?: string[];
  sections?: WikiSection[];
  product_id?: string | null;
  sku_id?: string | null;
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
      const response = await api.get<Wiki[]>('/api/v1/wiki', {
        params: { limit: 100 }
      });

      const data = Array.isArray(response) ? response : [];
      setWikis(data);
      return data;
    } catch (error: unknown) {
      console.error('Error fetching wikis:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to fetch wikis: ${message}`,
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
      const data = await api.get<Wiki>(`/api/v1/wiki/${id}`);
      return data;
    } catch (error: unknown) {
      console.error('Error fetching wiki:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to fetch wiki: ${message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [tenantId, toast]);

  const createWiki = useCallback(async (wikiData: CreateWikiData): Promise<Wiki | null> => {
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant ID available',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const data = await api.post<Wiki>('/api/v1/wiki', {
        ...wikiData,
        sections: wikiData.sections || [],
        tools_required: wikiData.tools_required || [],
      });

      toast({
        title: 'Success',
        description: 'Wiki created successfully',
      });

      await fetchWikis();
      return data;
    } catch (error: unknown) {
      console.error('Error creating wiki:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to create wiki: ${message}`,
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
      const data = await api.put<Wiki>(`/api/v1/wiki/${id}`, updates);

      toast({
        title: 'Success',
        description: 'Wiki updated successfully',
      });

      await fetchWikis();
      return data;
    } catch (error: unknown) {
      console.error('Error updating wiki:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to update wiki: ${message}`,
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
      await api.delete(`/api/v1/wiki/${id}`);

      toast({
        title: 'Success',
        description: 'Wiki deleted successfully',
      });

      await fetchWikis();
      return true;
    } catch (error: unknown) {
      console.error('Error deleting wiki:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to delete wiki: ${message}`,
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

      // Upload to cloud R2 storage via files endpoint
      const response = await api.upload<{ url: string }>('/api/v1/files/wiki-image', file, 'file');

      toast({
        title: 'Success',
        description: 'Image uploaded successfully',
      });

      return response.url;
    } catch (error: unknown) {
      console.error('Error uploading image:', error);
      const message = error instanceof ApiError ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: `Failed to upload image: ${message}`,
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
      // Get SKU info first
      const skuResponse = await api.get<{ id: string; product_id: string | null }>(`/api/v1/skus/by-sku/${sku}`);

      if (!skuResponse) {
        console.warn('SKU not found:', sku);
        return null;
      }

      // Try to find wiki by sku_id
      const wikisResponse = await api.get<Wiki[]>('/api/v1/wiki', {
        params: { sku_id: skuResponse.id, limit: 1 }
      });

      if (Array.isArray(wikisResponse) && wikisResponse.length > 0) {
        return wikisResponse[0];
      }

      // Fallback: try to find wiki by product_id
      if (skuResponse.product_id) {
        const productWikisResponse = await api.get<Wiki[]>('/api/v1/wiki', {
          params: { product_id: skuResponse.product_id, limit: 1 }
        });

        if (Array.isArray(productWikisResponse) && productWikisResponse.length > 0) {
          return productWikisResponse[0];
        }
      }

      // No wiki found
      return null;
    } catch (error: unknown) {
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
