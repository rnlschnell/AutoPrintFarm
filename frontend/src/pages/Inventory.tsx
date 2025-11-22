import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useProductInventory } from "@/hooks/useProductInventory";
import { MoreHorizontal, Package, Plus, ChevronDown, ChevronRight, Wrench, CheckCircle, AlertCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import AdjustStockModal from "@/components/AdjustStockModal";
import { formatCurrency, formatNumber } from "@/lib/utils";

// Removed the getAssemblyStatusBadge function as we no longer show these badges in SKU rows

// Helper function to determine stock status badge
const getStockStatusBadge = (totalStock: number, threshold: number) => {
  if (totalStock === 0) {
    return <Badge variant="destructive">Out of Stock</Badge>;
  }
  if (totalStock <= threshold) {
    return <Badge variant="warning">Low Stock</Badge>;
  }
  return <Badge variant="success">In Stock</Badge>;
};

const Inventory = () => {
  const { productInventory, loading, updateStock, getFilteredInventory } = useProductInventory();
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState<any>(null);
  const [selectedAssemblyType, setSelectedAssemblyType] = useState<'assembled' | 'needs_assembly' | undefined>(undefined);
  const [filterMode, setFilterMode] = useState<'all' | 'assembled' | 'needs_assembly'>('all');
  const { toast } = useToast();

  const toggleProduct = (productId: string) => {
    const newExpanded = new Set(expandedProducts);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedProducts(newExpanded);
  };

  const handleAdjustStock = (sku: any, assemblyType?: 'assembled' | 'needs_assembly') => {
    setSelectedSku(sku);
    setSelectedAssemblyType(assemblyType);
    setIsStockModalOpen(true);
  };

  const handleStockAdjust = async (skuId: string, newQuantity: number, assemblyType?: 'assembled' | 'needs_assembly') => {
    await updateStock(skuId, newQuantity, assemblyType);
    setSelectedSku(null);
  };

  // Calculate summary statistics and get filtered data
  const filteredInventory = getFilteredInventory(filterMode);
  const totalProducts = productInventory.length;
  const totalSkus = productInventory.reduce((sum, product) => sum + product.skus.length, 0);
  const totalStock = productInventory.reduce((sum, product) => sum + product.totalStock, 0);
  const totalValue = productInventory.reduce((sum, product) => sum + product.totalValue, 0);
  const totalAssembled = productInventory.reduce((sum, product) => sum + product.totalAssembled, 0);
  const totalNeedsAssembly = productInventory.reduce((sum, product) => sum + product.totalNeedsAssembly, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finished Goods Inventory</h1>
          <p className="text-muted-foreground">Track printed items, assembly tasks, and ready products.</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={filterMode} onValueChange={(value) => value && setFilterMode(value as 'all' | 'assembled' | 'needs_assembly')}>
            <ToggleGroupItem value="all" aria-label="All Products">
              All Products
            </ToggleGroupItem>
            <ToggleGroupItem value="assembled" aria-label="Assembled">
              Assembled
            </ToggleGroupItem>
            <ToggleGroupItem value="needs_assembly" aria-label="Needs Assembly">
              Needs Assembly
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts}</div>
            <p className="text-xs text-muted-foreground">{totalSkus} total SKUs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Assembled</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAssembled}</div>
            <p className="text-xs text-muted-foreground">ready for sale</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Assembly</CardTitle>
            <Wrench className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalNeedsAssembly}</div>
            <p className="text-xs text-muted-foreground">awaiting assembly</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground">{formatNumber(totalStock)} units</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="w-full">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 pb-4 border-b border-border">
              <div className="col-span-4 text-left text-sm font-medium text-muted-foreground">
                Product
              </div>
              <div className="col-span-2 text-center text-sm font-medium text-muted-foreground">
                Assembled
              </div>
              <div className="col-span-2 text-center text-sm font-medium text-muted-foreground">
                Needs Assembly
              </div>
              <div className="col-span-2 text-center text-sm font-medium text-muted-foreground">
                Total Stock
              </div>
              <div className="col-span-2 text-right text-sm font-medium text-muted-foreground">
                Value
              </div>
            </div>

            {/* Content */}
            <div className="divide-y divide-border">
              {filteredInventory.map((product) => (
                <div key={product.productId}>
                  {/* Product Row */}
                  <div className="grid grid-cols-12 gap-4 py-4 hover:bg-muted/50 cursor-pointer" onClick={() => toggleProduct(product.productId)}>
                    {/* Product Column */}
                    <div className="col-span-4 flex items-center gap-3">
                      <div className="flex-shrink-0">
                        {expandedProducts.has(product.productId) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {product.imageUrl ? (
                          <img 
                            src={product.imageUrl} 
                            alt={product.productName}
                            className="w-10 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{product.productName}</div>
                        <div className="text-sm text-muted-foreground">
                          {product.requiresAssembly ? 'Requires Assembly' : 'Ready to Print'}
                        </div>
                      </div>
                    </div>

                    {/* Assembled Column */}
                    <div className="col-span-2 flex flex-col items-center justify-center">
                      <div className="font-medium">{product.totalAssembled}</div>
                      <div className="text-sm text-muted-foreground">units</div>
                    </div>

                    {/* Needs Assembly Column */}
                    <div className="col-span-2 flex flex-col items-center justify-center">
                      <div className="font-medium">{product.totalNeedsAssembly}</div>
                      <div className="text-sm text-muted-foreground">units</div>
                    </div>

                    {/* Stock Column */}
                    <div className="col-span-2 flex flex-col items-center justify-center">
                      <div className="font-medium">{product.totalStock}</div>
                      <div className="text-sm text-muted-foreground">total</div>
                    </div>

                    {/* Value Column */}
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <div className="text-right">
                        <div className="font-medium">{formatCurrency(product.totalValue)}</div>
                        <div className="text-xs text-muted-foreground">total value</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded SKUs */}
                  {expandedProducts.has(product.productId) && (
                    <div className="bg-muted/25 border-l-4 border-primary/20">
                      {product.skus.map((sku) => (
                        <div key={sku.id} className="grid grid-cols-12 gap-4 py-3 hover:bg-muted/50">
                          {/* SKU Product Column */}
                          <div className="col-span-4 flex items-center gap-3 pl-8">
                            <div className="flex-1">
                              <div className="font-medium text-sm">{sku.sku}</div>
                               <div className="text-xs text-muted-foreground">
                                 {sku.color} • {sku.material} • {formatCurrency(sku.unitPrice)}
                               </div>
                             </div>
                          </div>

                          {/* SKU Assembled Column */}
                          <div className="col-span-2 flex items-center justify-center">
                            <button
                              className="w-16 h-16 flex flex-col items-center justify-center cursor-pointer hover:bg-accent hover:ring-2 hover:ring-accent-foreground/20 rounded-md transition-all duration-200"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdjustStock(sku, 'assembled');
                              }}
                              title="Click to adjust assembled inventory"
                            >
                              <div className="font-medium">{sku.quantityAssembled}</div>
                              <div className="text-xs text-muted-foreground">units</div>
                            </button>
                          </div>

                          {/* SKU Needs Assembly Column */}
                          <div className="col-span-2 flex items-center justify-center">
                            <button
                              className="w-16 h-16 flex flex-col items-center justify-center cursor-pointer hover:bg-accent hover:ring-2 hover:ring-accent-foreground/20 rounded-md transition-all duration-200"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdjustStock(sku, 'needs_assembly');
                              }}
                              title="Click to adjust needs assembly inventory"
                            >
                              <div className="font-medium">{sku.quantityNeedsAssembly}</div>
                              <div className="text-xs text-muted-foreground">units</div>
                            </button>
                          </div>

                          {/* SKU Stock Column */}
                          <div className="col-span-2 flex flex-col items-center justify-center">
                            <div className="font-medium">{sku.currentStock}</div>
                            <div className="text-xs text-muted-foreground">total</div>
                          </div>

                          {/* SKU Badge Column */}
                          <div className="col-span-2 flex items-center justify-center">
                            {getStockStatusBadge(sku.currentStock, sku.lowStockThreshold)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              
              {filteredInventory.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  {filterMode === 'all' 
                    ? "No products found. Create products and SKUs to see inventory here."
                    : `No products found with ${filterMode === 'assembled' ? 'assembled' : 'needs assembly'} status.`
                  }
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <AdjustStockModal
        product={selectedSku ? {
          id: selectedSku.id,
          name: selectedSku.sku,
          quantity: selectedSku.currentStock,
          quantityAssembled: selectedSku.quantityAssembled,
          quantityNeedsAssembly: selectedSku.quantityNeedsAssembly
        } : null}
        isOpen={isStockModalOpen}
        onClose={() => {
          setIsStockModalOpen(false);
          setSelectedAssemblyType(undefined);
        }}
        onAdjust={handleStockAdjust}
        initialAssemblyType={selectedAssemblyType}
      />
    </div>
  );
};

export default Inventory;
