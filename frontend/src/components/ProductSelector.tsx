import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAvailableProducts, type AvailableProduct } from "@/hooks/useAvailableFiles";
import { Package, HardDrive, Clock, FileText } from "lucide-react";

interface ProductSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

const ProductSelector = ({ value, onValueChange, disabled = false }: ProductSelectorProps) => {
  const { products, loading } = useAvailableProducts();

  const formatFileSize = (sizeBytes: number): string => {
    if (sizeBytes < 1024 * 1024) {
      return `${Math.round(sizeBytes / 1024)} KB`;
    }
    return `${Math.round(sizeBytes / (1024 * 1024) * 10) / 10} MB`;
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="product">Product *</Label>
      <Select 
        value={value} 
        onValueChange={onValueChange}
        disabled={disabled || loading}
      >
        <SelectTrigger id="product">
          <SelectValue 
            placeholder={
              loading 
                ? "Loading products..." 
                : products.length === 0 
                  ? "No products with files available"
                  : "Select product"
            } 
          />
        </SelectTrigger>
        <SelectContent>
          {products.length === 0 && !loading && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              <span>No products with print files found</span>
            </div>
          )}
          {products.map((product: AvailableProduct) => (
            <SelectItem key={product.id} value={product.id}>
              <div className="flex items-start gap-2 w-full">
                <Package className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {product.name}
                  </div>
                  {product.description && (
                    <div className="text-xs text-muted-foreground truncate mb-1">
                      {product.description}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {product.category && (
                      <span className="px-1.5 py-0.5 bg-muted rounded text-xs">
                        {product.category}
                      </span>
                    )}
                    {product.file_info && (
                      <>
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {formatFileSize(product.file_info.size_bytes)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(product.file_info.created_at)}
                        </span>
                      </>
                    )}
                  </div>
                  {product.requires_assembly && (
                    <div className="text-xs text-amber-600 mt-1">
                      ⚠️ Requires assembly
                    </div>
                  )}
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {products.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {products.length} product{products.length !== 1 ? 's' : ''} with available files
        </p>
      )}
      
      {products.length === 0 && !loading && (
        <p className="text-xs text-orange-600">
          No products with print files found. Create products and upload files first.
        </p>
      )}
    </div>
  );
};

export default ProductSelector;