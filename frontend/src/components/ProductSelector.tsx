import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAvailableProducts, type AvailableProduct } from "@/hooks/useAvailableFiles";
import { Package } from "lucide-react";

interface ProductSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

const ProductSelector = ({ value, onValueChange, disabled = false }: ProductSelectorProps) => {
  const { products, loading } = useAvailableProducts();

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
                    <div className="text-xs text-muted-foreground truncate">
                      {product.description}
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