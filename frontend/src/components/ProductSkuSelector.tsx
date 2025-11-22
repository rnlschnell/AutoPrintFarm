import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ColorSwatch from "@/components/ColorSwatch";
import { Package } from "lucide-react";

interface ProductSku {
  id: string;
  product_id: string;
  sku: string;
  color: string;
  hex_code: string;
  filament_type: string;
  quantity: number;
  stock_level: number;
  price?: number;
  is_active: boolean;
}

interface ProductSkuSelectorProps {
  productId: string;
  value: string;
  onValueChange: (skuId: string, skuData: ProductSku) => void;
  disabled?: boolean;
}

const ProductSkuSelector = ({ productId, value, onValueChange, disabled = false }: ProductSkuSelectorProps) => {
  const [skus, setSkus] = useState<ProductSku[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (productId) {
      fetchSkus();
    } else {
      setSkus([]);
    }
  }, [productId]);

  const fetchSkus = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/product-skus-sync/product/${productId}`);
      if (response.ok) {
        const data = await response.json();
        // Filter to only show active SKUs
        const activeSkus = data.filter((sku: ProductSku) => sku.is_active !== false);
        setSkus(activeSkus);
      } else {
        console.error("Failed to fetch SKUs");
        setSkus([]);
      }
    } catch (error) {
      console.error("Error fetching SKUs:", error);
      setSkus([]);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (skuId: string) => {
    const selectedSku = skus.find(sku => sku.id === skuId);
    if (selectedSku) {
      onValueChange(skuId, selectedSku);
    }
  };

  if (!productId) {
    return (
      <div className="space-y-2">
        <Label htmlFor="sku">Product Variant (SKU)</Label>
        <Select disabled>
          <SelectTrigger id="sku">
            <SelectValue placeholder="Select a product first" />
          </SelectTrigger>
          <SelectContent>
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              <span>Please select a product to see available SKUs</span>
            </div>
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="sku">Product Variant (SKU) *</Label>
      <Select 
        value={value} 
        onValueChange={handleChange}
        disabled={disabled || loading}
      >
        <SelectTrigger id="sku">
          <SelectValue 
            placeholder={
              loading 
                ? "Loading SKUs..." 
                : skus.length === 0 
                  ? "No SKUs available"
                  : "Select variant"
            } 
          />
        </SelectTrigger>
        <SelectContent>
          {skus.length === 0 && !loading && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4" />
              <span>No SKUs found for this product</span>
            </div>
          )}
          {skus.map((sku) => (
            <SelectItem key={sku.id} value={sku.id}>
              <div className="flex items-start gap-2 w-full">
                <ColorSwatch 
                  color={`${sku.color}|${sku.hex_code}`} 
                  size="sm" 
                  className="mt-0.5 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {sku.sku}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {sku.color} • {sku.filament_type}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span>Qty/Print: {sku.quantity}</span>
                    <span>Stock: {sku.stock_level}</span>
                    {sku.price && (
                      <span>Price: ${(sku.price / 100).toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {skus.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {skus.length} variant{skus.length !== 1 ? 's' : ''} available
        </p>
      )}
      
      {skus.length === 0 && !loading && productId && (
        <p className="text-xs text-orange-600">
          No SKUs found for this product. Please add SKUs in the Products page.
        </p>
      )}
    </div>
  );
};

export default ProductSkuSelector;
