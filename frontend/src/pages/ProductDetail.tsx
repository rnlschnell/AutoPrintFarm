import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const ProductDetail = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const type = searchParams.get('type');

  // Mock data - in a real app, this would come from your data source
  const getProductData = () => {
    const productId = parseInt(id || '0');
    
    if (type === 'filament') {
      const filaments = [
        {
          id: 1,
          name: 'SUNLU PLA+ Filament',
          brand: 'SUNLU',
          material: 'PLA+',
          color: 'Black',
          price: 25.99,
          originalPrice: 29.99,
          weight: '1kg',
          diameter: '1.75mm',
          inStock: true,
          description: 'High-quality PLA+ filament with excellent layer adhesion and minimal warping. Perfect for beginners and professionals alike.',
          features: [
            'Easy to print',
            'Low odor',
            'Excellent surface finish',
            'Wide temperature range'
          ]
        }
      ];
      return filaments.find(f => f.id === productId);
    }
    
    if (type === 'accessory') {
      const accessories = [
        {
          id: 1,
          name: 'Build Plate',
          brand: 'Bambu Lab',
          type: 'Print Surface',
          price: 39.99,
          compatibility: 'A1 Series',
          inStock: true,
          description: 'Premium build plate designed for optimal first layer adhesion and easy print removal.',
          features: [
            'Easy print removal',
            'Excellent adhesion',
            'Durable coating',
            'Easy to clean'
          ]
        }
      ];
      return accessories.find(a => a.id === productId);
    }
    
    if (type === 'tool') {
      const tools = [
        {
          id: 1,
          name: 'Digital Calipers',
          brand: 'Mitutoyo',
          type: 'Measurement',
          price: 89.99,
          accuracy: '±0.02mm',
          inStock: true,
          description: 'Professional-grade digital calipers for precise measurements of 3D printed parts and filament dimensions.',
          features: [
            'High precision',
            'Digital display',
            'Stainless steel construction',
            'Battery included'
          ]
        }
      ];
      return tools.find(t => t.id === productId);
    }
    
    return null;
  };

  const product = getProductData();

  if (!product) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-4">Product not found</h1>
          <Button onClick={() => navigate('/store')} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Button 
          onClick={() => navigate('/store')} 
          variant="ghost" 
          className="mb-8 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Store
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Product Image */}
          <div className="space-y-4">
            <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center relative">
              {product.id === 1 && (
                <Badge className="absolute top-4 left-4 bg-red-500 hover:bg-red-500 text-white">
                  SALE
                </Badge>
              )}
              <span className="text-gray-400">Product Image</span>
            </div>
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-500 mb-2">{product.brand}</p>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{product.name}</h1>
              
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                  {(product as any).originalPrice && (
                    <span className="text-lg text-gray-500 line-through">${(product as any).originalPrice}</span>
                  )}
                  <span className="text-3xl font-bold text-gray-900">${product.price}</span>
                </div>
                <Badge variant={product.inStock ? "default" : "secondary"}>
                  {product.inStock ? "In Stock" : "Out of Stock"}
                </Badge>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Description</h3>
              <p className="text-gray-600 leading-relaxed">{product.description}</p>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Features</h3>
              <ul className="space-y-2">
                {product.features.map((feature, index) => (
                  <li key={index} className="flex items-center text-gray-600">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-3"></div>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Specifications</h3>
              <div className="space-y-2 text-sm">
                {type === 'filament' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Material:</span>
                      <span className="text-gray-900">{(product as any).material}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Color:</span>
                      <span className="text-gray-900">{(product as any).color}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Weight:</span>
                      <span className="text-gray-900">{(product as any).weight}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Diameter:</span>
                      <span className="text-gray-900">{(product as any).diameter}</span>
                    </div>
                  </>
                )}
                {type === 'accessory' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Type:</span>
                      <span className="text-gray-900">{(product as any).type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Compatibility:</span>
                      <span className="text-gray-900">{(product as any).compatibility}</span>
                    </div>
                  </>
                )}
                {type === 'tool' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Type:</span>
                      <span className="text-gray-900">{(product as any).type}</span>
                    </div>
                    {(product as any).accuracy && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Accuracy:</span>
                        <span className="text-gray-900">{(product as any).accuracy}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-4 pt-6">
              <Button 
                className="flex-1 h-12" 
                disabled={!product.inStock}
                size="lg"
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                Add to Cart
              </Button>
              <Button variant="outline" size="lg" className="h-12 px-6">
                <Heart className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;