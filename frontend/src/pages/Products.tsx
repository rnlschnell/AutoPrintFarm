import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PlusCircle,
  List,
  LayoutGrid,
  Edit,
  Package,
  ChevronDown,
  ChevronRight,
  File,
  MoreHorizontal,
  Settings,
  Eye,
  BookOpen
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useProductsNew, ProductWithDetails, ProductSku } from '@/hooks/useProductsNew';
import { ProductModal } from '@/components/ProductModal';
import { usePrintFiles } from '@/hooks/usePrintFiles';
import ColorSwatch from '@/components/ColorSwatch';
import { formatCurrency, formatNumber } from '@/lib/utils';

const Products = () => {
  const navigate = useNavigate();
  const { products, loading, addProduct, updateProduct, deleteProduct, updateSku, deleteSku } = useProductsNew();
  const { setFileVersionAsCurrent } = usePrintFiles();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<ProductWithDetails | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
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

  const handleProductClick = (product: ProductWithDetails) => {
    setSelectedProduct(product);
    setIsEditMode(false);
    setIsProductModalOpen(true);
  };

  const handleEditProduct = (product: ProductWithDetails) => {
    setSelectedProduct(product);
    setIsEditMode(true);
    setIsProductModalOpen(true);
  };

  const handleAddProduct = () => {
    setSelectedProduct(null);
    setIsEditMode(false);
    setIsProductModalOpen(true);
  };

  const handleProductSave = async (productData: any) => {
    try {
      if (selectedProduct) {
        // If we have a selectedProduct, always update it (never create new)
        await updateProduct(selectedProduct.id, productData);
      } else {
        // Only create new product when no selectedProduct exists
        await addProduct(productData);
      }
      setSelectedProduct(null);
      setIsEditMode(false);
    } catch (error) {
      console.error('Error saving product:', error);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    try {
      await deleteProduct(productId);
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  const getStatusBadge = (stock: number) => {
    if (stock === 0) return <Badge variant="destructive">Out of Stock</Badge>;
    if (stock < 10) return <Badge className="bg-yellow-500 text-black hover:bg-yellow-600">Low Stock</Badge>;
    return <Badge className="bg-green-600 text-white hover:bg-green-700">In Stock</Badge>;
  };

  if (loading) {
    return <div>Loading products...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">Manage your 3D print product catalog with print files, components, and SKUs.</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as 'list' | 'grid')}>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" onClick={() => navigate('/wiki-management')}>
            <BookOpen className="mr-2 h-4 w-4" />
            Wiki
          </Button>
          <Button onClick={handleAddProduct}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>
      
      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
            <Package className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No products found</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            You haven't added any products to your catalog yet. Add your first product to get started.
          </p>
          <Button onClick={handleAddProduct}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Your First Product
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <Card key={product.id} className="cursor-pointer hover:shadow-lg transition-shadow flex flex-col" onClick={() => handleProductClick(product)}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-start gap-3 min-w-0 flex-1 pr-2">
                  <div className="flex-shrink-0">
                    {product.image_url ? (
                      <img 
                        src={product.image_url} 
                        alt={product.name}
                        className="w-12 h-12 rounded object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-lg truncate">{product.name}</CardTitle>
                    <CardDescription>{product.description}</CardDescription>
                  </div>
                </div>
                <Badge className="shrink-0 text-white hover:bg-[#1a2e56]" style={{ backgroundColor: '#192A52' }}>
                  {product.skus.length} SKU{product.skus.length !== 1 ? 's' : ''}
                </Badge>
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <File className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {product.file_name || product.print_file?.name || 'No print file'}
                    </span>
                  </div>
                  {!!product.requires_assembly && product.components.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{product.components.length} component{product.components.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <div className="flex flex-col gap-2 w-full">
                  <div className="text-sm">
                    <span className="font-medium">Total Stock: </span>
                    {formatNumber(product.skus.reduce((sum, sku) => sum + (sku.finishedGoodsStock || 0), 0))} units
                  </div>
                  <div className="flex items-center justify-between w-full">
                    {product.skus.length > 0 && (() => {
                      const minPrice = Math.min(...product.skus.map(s => s.price || 0));
                      const maxPrice = Math.max(...product.skus.map(s => s.price || 0));
                      return (
                        <span className="text-sm text-muted-foreground">
                          {formatCurrency(minPrice)}{minPrice !== maxPrice ? ` - ${formatCurrency(maxPrice)}` : ''}
                        </span>
                      );
                    })()}
                    {(!!product.requires_assembly || !!product.requires_post_processing) && (
                      <Badge variant="secondary" className="text-xs">
                        {product.requires_assembly && product.requires_post_processing
                          ? "Processing + Assembly Required"
                          : product.requires_assembly
                          ? "Assembly Required"
                          : "Post-Processing Required"}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="w-full">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 pb-4 border-b border-border">
                <div className="col-span-4 text-left text-sm font-medium text-muted-foreground">
                  Product
                </div>
                <div className="col-span-2 text-left text-sm font-medium text-muted-foreground">
                  Print File
                </div>
                <div className="col-span-2 text-center text-sm font-medium text-muted-foreground">
                  SKUs
                </div>
                <div className="col-span-2 text-center text-sm font-medium text-muted-foreground">
                  Total Stock
                </div>
                <div className="col-span-1 text-center text-sm font-medium text-muted-foreground">
                  Assembly
                </div>
                <div className="col-span-1 text-right text-sm font-medium text-muted-foreground">
                  Actions
                </div>
              </div>

              {/* Content */}
              <div className="divide-y divide-border">
                {products.map((product) => {
                  const isExpanded = expandedProducts.has(product.id);
                  const totalStock = product.skus.reduce((sum, sku) => sum + (sku.finishedGoodsStock || 0), 0);

                  return (
                    <div key={product.id}>
                      {/* Product Row */}
                      <div className="grid grid-cols-12 gap-4 py-4 hover:bg-muted/50">
                        {/* Product Column */}
                        <div className="col-span-4 flex items-center gap-3">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="p-0 h-6 w-6 flex-shrink-0"
                            onClick={() => toggleProduct(product.id)}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                          <div className="flex-shrink-0">
                            {product.image_url ? (
                              <img 
                                src={product.image_url} 
                                alt={product.name}
                                className="w-10 h-10 rounded object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <button 
                            onClick={() => handleProductClick(product)}
                            className="text-left hover:underline font-medium"
                          >
                            {product.name}
                          </button>
                        </div>

                        {/* Print File Column */}
                        <div className="col-span-2 flex items-center">
                          <div className="text-sm">
                            <div className="font-medium">{product.file_name || product.print_file?.name || 'No file'}</div>
                            <div className="text-muted-foreground">
                              {product.file_name || product.print_file ? 'Active' : 'No file'}
                            </div>
                          </div>
                        </div>

                        {/* SKUs Column */}
                        <div className="col-span-2 flex flex-col items-center justify-center">
                          <div className="font-medium">{product.skus.length}</div>
                          <div className="text-sm text-muted-foreground">SKUs</div>
                        </div>

                        {/* Total Stock Column */}
                        <div className="col-span-2 flex flex-col items-center justify-center">
                          <div className="font-medium">{formatNumber(totalStock)}</div>
                          <div className="text-sm text-muted-foreground">units</div>
                        </div>

                        {/* Assembly Column */}
                        <div className="col-span-1 flex items-center justify-center">
                          {product.requires_assembly ? (
                            <Badge variant="secondary">Required</Badge>
                          ) : (
                            <Badge variant="outline">None</Badge>
                          )}
                        </div>

                        {/* Actions Column */}
                        <div className="col-span-1 flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleProductClick(product)}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEditProduct(product)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Product
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* SKU Rows */}
                      {isExpanded && product.skus.map((sku) => (
                        <div key={sku.id} className="grid grid-cols-12 gap-4 py-3 bg-muted/20">
                          {/* Product Column - Indented */}
                          <div className="col-span-4 flex items-center gap-3 pl-12">
                             <div className="text-sm space-y-1">
                               <div className="font-medium text-base">{sku.sku}</div>
                               <div className="flex items-center gap-3 text-muted-foreground">
                                 <div className="flex items-center gap-1">
                                   <ColorSwatch 
                                     color={sku.hex_code || sku.color} 
                                     filamentType={sku.filament_type}
                                     size="sm" 
                                   />
                                   <span>{sku.color}</span>
                                 </div>
                                 {sku.filament_type && (
                                   <span>({sku.filament_type})</span>
                                 )}
                                 <span>Qty per SKU: {sku.quantity}</span>
                               </div>
                             </div>
                          </div>

                          {/* Print File Column */}
                          <div className="col-span-2 flex items-center">
                            <div className="text-sm text-muted-foreground">
                              {formatCurrency(sku.price || 0)}
                            </div>
                          </div>

                          {/* SKUs Column */}
                          <div className="col-span-2 flex items-center justify-center">
                            <div className="text-sm text-muted-foreground">-</div>
                          </div>

                          {/* Stock Column */}
                          <div className="col-span-2 flex flex-col items-center justify-center">
                            <div className="font-medium">{formatNumber(sku.finishedGoodsStock || 0)}</div>
                            {getStatusBadge(sku.finishedGoodsStock || 0)}
                          </div>

                          {/* Assembly Column */}
                          <div className="col-span-1 flex items-center justify-center">
                            <div className="text-sm text-muted-foreground">-</div>
                          </div>

                          {/* Actions Column */}
                          <div className="col-span-1 flex items-center justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => deleteSku(sku.id)}>
                                  Delete SKU
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product Modal */}
      <ProductModal
        product={selectedProduct}
        isOpen={isProductModalOpen}
        onClose={() => {
          setIsProductModalOpen(false);
          setSelectedProduct(null);
          setIsEditMode(false);
        }}
        onSave={handleProductSave}
        onDelete={handleDeleteProduct}
        initialEditMode={isEditMode}
      />

    </div>
  );
};

export default Products;
