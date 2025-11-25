import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { api } from '@/lib/api-client';

export interface AvailableFile {
  id: string;
  filename: string;
  local_path: string;
  size_bytes: number;
  size_mb: number;
  created_at: string;
  modified_at: string;
  exists: boolean;
}

export interface AvailableProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  print_file_id?: string;
  requires_assembly: boolean;
  image_url?: string;
  created_at?: string;
  file_available: boolean;
  file_info?: {
    local_path: string;
    size_bytes: number;
    size_mb: number;
    created_at: string;
    modified_at: string;
  };
}

export const useAvailableFiles = () => {
  const [printFiles, setPrintFiles] = useState<AvailableFile[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAvailableFiles = async () => {
    try {
      setLoading(true);
      
      // Use central API URL utility
      const baseUrl = getApiBaseUrl();

      const response = await fetch(`${baseUrl}/api/available-files/print-files`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch available files: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        setPrintFiles(data.files || []);
      } else {
        throw new Error(data.message || 'Failed to fetch available files');
      }
      
    } catch (error: any) {
      console.error('Error fetching available files:', error);
      toast({
        title: "Error",
        description: "Failed to load available print files from Pi",
        variant: "destructive",
      });
      setPrintFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableFiles();
  }, []);

  return {
    printFiles,
    loading,
    refetch: fetchAvailableFiles
  };
};

export const useAvailableProducts = () => {
  const [products, setProducts] = useState<AvailableProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenant, isInitialized } = useTenant();

  const fetchAvailableProducts = async () => {
    if (!tenant?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch products and print files from cloud API in parallel
      const [productsData, filesData] = await Promise.all([
        api.get<any[]>('/api/v1/products'),
        api.get<any[]>('/api/v1/files')
      ]);

      // Create a map of product IDs that have at least one print file
      const productIdsWithFiles = new Set(
        (filesData || [])
          .filter((f: any) => f.product_id)
          .map((f: any) => f.product_id)
      );

      // Filter products to only those with print files and map to AvailableProduct interface
      const productsWithFiles: AvailableProduct[] = (productsData || [])
        .filter((p: any) => productIdsWithFiles.has(p.id))
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          print_file_id: p.print_file_id,
          requires_assembly: p.requires_assembly || false,
          image_url: p.image_url,
          created_at: p.created_at,
          file_available: true,
        }));

      setProducts(productsWithFiles);

    } catch (error: any) {
      console.error('Error fetching available products:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to load available products",
        variant: "destructive",
      });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Wait for auth to be initialized before fetching
    if (!isInitialized) {
      return;
    }
    fetchAvailableProducts();
  }, [isInitialized, tenant?.id]);

  return {
    products,
    loading,
    refetch: fetchAvailableProducts
  };
};