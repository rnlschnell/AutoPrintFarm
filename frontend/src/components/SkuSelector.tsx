import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package2 } from "lucide-react";
import { api } from "@/lib/api-client";

interface Sku {
  id: string;
  product_id: string;
  sku: string;
  color: string;
  filament_type: string;
  hex_code: string;
  quantity: number;
  stock_level: number;
  price: number;
  is_active: number;
}

interface SkuSelectorProps {
  productId: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

const SkuSelector = ({ productId, value, onValueChange, disabled = false }: SkuSelectorProps) => {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId) {
      setSkus([]);
      return;
    }

    const fetchSkus = async () => {
      setLoading(true);
      try {
        // Use cloud API to fetch SKUs filtered by product_id
        const allSkus = await api.get<Sku[]>('/api/v1/skus', { params: { product_id: productId } });

        // Filter to only active SKUs (is_active could be 1 or true)
        const productSkus = (allSkus || []).filter((sku: Sku) =>
          sku.is_active === 1 || sku.is_active === true as any
        );

        setSkus(productSkus);
      } catch (error) {
        console.error('Error fetching SKUs:', error);
        setSkus([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSkus();
  }, [productId]);



  if (!productId) {
    return (
      <div className="space-y-2">
        <Label>SKU *</Label>
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder="Select a product first" />
          </SelectTrigger>
        </Select>
        <p className="text-xs text-muted-foreground">
          Choose a product to see available SKUs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="sku">SKU *</Label>
      <Select 
        value={value} 
        onValueChange={onValueChange}
        disabled={disabled || loading}
      >
        <SelectTrigger id="sku">
          <SelectValue 
            placeholder={
              loading 
                ? "Loading SKUs..." 
                : skus.length === 0 
                  ? "No SKUs available"
                  : "Select SKU"
            } 
          />
        </SelectTrigger>
        <SelectContent>
          {skus.length === 0 && !loading && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Package2 className="h-4 w-4" />
              <span>No active SKUs found for this product</span>
            </div>
          )}
          {skus.map((sku) => (
            <SelectItem key={sku.id} value={sku.id}>
              <div className="flex items-center gap-2">
                <Package2 className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium">{sku.sku}</span>
                <span className="text-muted-foreground">-</span>
                <div
                  className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                  style={{ backgroundColor: sku.hex_code }}
                />
                <span className="text-sm">{sku.color}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-sm text-muted-foreground">{sku.filament_type}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {skus.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {skus.length} SKU{skus.length !== 1 ? 's' : ''} available
        </p>
      )}
      
      {skus.length === 0 && !loading && productId && (
        <p className="text-xs text-orange-600">
          No SKUs found. Create SKUs for this product first.
        </p>
      )}
    </div>
  );
};

export default SkuSelector;
