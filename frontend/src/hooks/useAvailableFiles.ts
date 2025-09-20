import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

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
      
      // Determine API base URL (similar to piFileService logic)
      const currentHost = window.location.hostname;
      let baseUrl: string;
      
      if (currentHost === '192.168.4.45' || currentHost === 'localhost' || currentHost === '127.0.0.1') {
        baseUrl = `${window.location.protocol}//${window.location.host}`;
      } else {
        baseUrl = 'http://192.168.4.45:8080';
      }

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

  const fetchAvailableProducts = async () => {
    try {
      setLoading(true);
      
      // Determine API base URL
      const currentHost = window.location.hostname;
      let baseUrl: string;
      
      if (currentHost === '192.168.4.45' || currentHost === 'localhost' || currentHost === '127.0.0.1') {
        baseUrl = `${window.location.protocol}//${window.location.host}`;
      } else {
        baseUrl = 'http://192.168.4.45:8080';
      }

      const response = await fetch(`${baseUrl}/api/available-files/products-with-files`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch available products: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        // Use only products with available files for the dropdown
        setProducts(data.products?.available || []);
      } else {
        throw new Error(data.message || 'Failed to fetch available products');
      }
      
    } catch (error: any) {
      console.error('Error fetching available products:', error);
      toast({
        title: "Error",
        description: "Failed to load available products from Pi",
        variant: "destructive",
      });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableProducts();
  }, []);

  return {
    products,
    loading,
    refetch: fetchAvailableProducts
  };
};