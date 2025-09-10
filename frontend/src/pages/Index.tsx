import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Printer, 
  FileText, 
  Package, 
  ShoppingCart, 
  TrendingUp, 
  Clock,
  AlertTriangle,
  CheckCircle,
  User,
  Wrench
} from "lucide-react";

const Index = () => {
  console.log('Index page component rendering');
  
  // Mock data for top 3 pending worklist items
  const topPendingTasks = [
    {
      id: 1,
      title: 'Load PLA+ Black filament on Printer A1-001',
      description: 'Current spool is running low (< 50g remaining)',
      type: 'filament_change',
      priority: 'high',
      assignedTo: 'John Doe',
      printer: 'A1-001',
      estimatedTime: 10
    },
    {
      id: 2,
      title: 'Replace nozzle on Printer X1C-002',
      description: 'Nozzle shows signs of wear',
      type: 'maintenance',
      priority: 'high',
      assignedTo: 'Alex Wilson',
      printer: 'X1C-002',
      estimatedTime: 30
    },
    {
      id: 3,
      title: 'Assemble custom phone case order #ORD-789',
      description: 'Attach phone case to packaging insert',
      type: 'assembly',
      priority: 'medium',
      assignedTo: 'Mike Johnson',
      estimatedTime: 15
    }
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'filament_change': return <Printer className="h-4 w-4" />;
      case 'assembly': return <Wrench className="h-4 w-4" />;
      case 'maintenance': return <Wrench className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 border-red-200';
      case 'medium': return 'text-orange-600 border-orange-200';
      case 'low': return 'text-gray-600 border-gray-200';
      default: return 'text-gray-600 border-gray-200';
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Dashboard Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Printers</CardTitle>
            <Printer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3/5</div>
            <p className="text-xs text-muted-foreground">60% utilization rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs in Queue</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">8</div>
            <p className="text-xs text-muted-foreground">~12 hours remaining</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">4</div>
            <p className="text-xs text-muted-foreground">Need reordering</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">$324</div>
            <p className="text-xs text-muted-foreground">+12% from yesterday</p>
          </CardContent>
        </Card>
      </div>

      {/* Worklist To do */}
      <Card>
        <CardHeader>
          <CardTitle>Worklist To do</CardTitle>
          <CardDescription>Top pending tasks requiring attention</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topPendingTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  {getTypeIcon(task.type)}
                  <div>
                    <h4 className="font-medium">{task.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {task.assignedTo} • {task.printer && `${task.printer} • `}{task.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className={getPriorityColor(task.priority)}>
                    {task.priority.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground border-gray-200">
                    <Clock className="w-3 h-3 mr-1" />
                    {task.estimatedTime} min
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Low Stock Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Low Stock Finished Goods</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Custom Phone Stand</p>
                  <p className="text-sm text-muted-foreground">SKU: PHS-001-BLK</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">0 units</p>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Desktop Organizer</p>
                  <p className="text-sm text-muted-foreground">SKU: ORG-002-WHT</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">0 units</p>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Cable Holder</p>
                  <p className="text-sm text-muted-foreground">SKU: CHD-003-GRY</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">2 units</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Wall Mount Bracket</p>
                  <p className="text-sm text-muted-foreground">SKU: WMB-004-BLK</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">3 units</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Desk Lamp Base</p>
                  <p className="text-sm text-muted-foreground">SKU: DLB-005-WHT</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">4 units</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low Stock Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">PLA+ Filament</p>
                  <p className="text-sm text-muted-foreground">Black • 1.75mm</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">45g</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">PETG Filament</p>
                  <p className="text-sm text-muted-foreground">Clear • 1.75mm</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">78g</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Cardboard Boxes</p>
                  <p className="text-sm text-muted-foreground">Small • 4x4x2 in</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">8 units</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Nozzles 0.4mm</p>
                  <p className="text-sm text-muted-foreground">Hardened Steel</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">1 unit</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Build Plates</p>
                  <p className="text-sm text-muted-foreground">PEI Sheet • A1 Mini</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">2 units</p>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fleet Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Printer Alpha (Idle)
                </span>
                <Badge variant="secondary">Ready</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                  Printer Beta (Printing)
                </span>
                <Badge className="bg-blue-100 text-blue-800">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Printer Gamma (Idle)
                </span>
                <Badge variant="secondary">Ready</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  Production Unit 1 (Printing)
                </span>
                <Badge className="bg-green-100 text-green-800">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  Production Unit 2 (Maintenance)
                </span>
                <Badge variant="outline" className="text-yellow-600 border-yellow-200">
                  Maintenance
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">ORD-2024-001</p>
                  <p className="text-sm text-muted-foreground">Sarah Johnson • Etsy</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">$24.98</p>
                  <Badge className="bg-blue-100 text-blue-800">Processing</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">ORD-2024-002</p>
                  <p className="text-sm text-muted-foreground">Mike Chen • Shopify</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">$15.99</p>
                  <Badge className="bg-green-100 text-green-800">Fulfilled</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">B2B-2024-001</p>
                  <p className="text-sm text-muted-foreground">TechCorp Industries • Manual</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">$124.95</p>
                  <Badge className="bg-blue-100 text-blue-800">Processing</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default Index;
