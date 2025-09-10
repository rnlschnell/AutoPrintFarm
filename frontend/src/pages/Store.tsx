import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';

const Store = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const navigate = useNavigate();

  const filaments = [
    {
      id: 1,
      name: 'SUNLU PLA+ Filament',
      brand: 'SUNLU',
      material: 'PLA+',
      color: 'Black',
      price: 25.99,
      weight: '1kg',
      diameter: '1.75mm',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 2,
      name: 'Bambu Lab ABS Filament',
      brand: 'Bambu Lab',
      material: 'ABS',
      color: 'White',
      price: 29.99,
      weight: '1kg',
      diameter: '1.75mm',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 3,
      name: 'eSUN PETG Filament',
      brand: 'eSUN',
      material: 'PETG',
      color: 'Clear',
      price: 32.99,
      weight: '1kg',
      diameter: '1.75mm',
      inStock: false,
      image: '/placeholder.svg'
    },
    {
      id: 4,
      name: 'Hatchbox TPU Flexible',
      brand: 'Hatchbox',
      material: 'TPU',
      color: 'Red',
      price: 45.99,
      weight: '1kg',
      diameter: '1.75mm',
      inStock: true,
      image: '/placeholder.svg'
    }
  ];

  const accessories = [
    {
      id: 1,
      name: 'Build Plate',
      brand: 'Bambu Lab',
      type: 'Print Surface',
      price: 39.99,
      compatibility: 'A1 Series',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 2,
      name: 'Nozzle Set (0.2-0.8mm)',
      brand: 'Generic',
      type: 'Printer Parts',
      price: 24.99,
      compatibility: 'Universal',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 3,
      name: 'PTFE Tube',
      brand: 'Capricorn',
      type: 'Printer Parts',
      price: 12.99,
      compatibility: 'Universal',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 4,
      name: 'Cleaning Kit',
      brand: 'PrintClean',
      type: 'Maintenance',
      price: 18.99,
      compatibility: 'Universal',
      inStock: false,
      image: '/placeholder.svg'
    }
  ];

  const tools = [
    {
      id: 1,
      name: 'Digital Calipers',
      brand: 'Mitutoyo',
      type: 'Measurement',
      price: 89.99,
      accuracy: '±0.02mm',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 2,
      name: 'Print Removal Tool Set',
      brand: 'Craftsman',
      type: 'Hand Tools',
      price: 15.99,
      material: 'Steel',
      inStock: true,
      image: '/placeholder.svg'
    },
    {
      id: 3,
      name: 'Heat Gun',
      brand: 'Wagner',
      type: 'Power Tools',
      price: 35.99,
      temperature: '300-1200°F',
      inStock: true,
      image: '/placeholder.svg'
    }
  ];

  const filteredFilaments = filaments.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (selectedCategory === 'all' || selectedCategory === 'filaments')
  );

  const filteredAccessories = accessories.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (selectedCategory === 'all' || selectedCategory === 'accessories')
  );

  const filteredTools = tools.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (selectedCategory === 'all' || selectedCategory === 'tools')
  );

  // Combine all products for the unified grid
  const allProducts = [
    ...filteredFilaments.map(p => ({ ...p, type: 'filament', category: 'filaments' })),
    ...filteredAccessories.map(p => ({ ...p, type: 'accessory', category: 'accessories' })),
    ...filteredTools.map(p => ({ ...p, type: 'tool', category: 'tools' }))
  ].filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || selectedCategory === product.category;
    return matchesSearch && matchesCategory;
  });

  const ProductCard = ({ product }: { product: any }) => (
    <div 
      className="group cursor-pointer"
      onClick={() => navigate(`/store/product/${product.id}?type=${product.type}`)}
    >
      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200">
        <div className="aspect-square bg-gray-50 flex items-center justify-center relative">
          {product.id === 1 && (
            <Badge className="absolute top-2 left-2 bg-red-500 hover:bg-red-500 text-white">
              SALE
            </Badge>
          )}
          <span className="text-gray-400 text-sm">Product Image</span>
        </div>
        <div className="p-4">
          <h3 className="font-medium text-gray-900 text-sm mb-1 line-clamp-2">{product.name}</h3>
          <p className="text-gray-900 font-semibold">${product.price}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-gray-200 focus:border-gray-300"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-48 border-gray-200">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="filaments">Filaments</SelectItem>
              <SelectItem value="accessories">Accessories</SelectItem>
              <SelectItem value="tools">Tools</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {allProducts.map((product) => (
            <ProductCard key={`${product.type}-${product.id}`} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Store;