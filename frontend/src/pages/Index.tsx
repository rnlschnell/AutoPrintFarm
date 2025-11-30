import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Printer,
  FileText,
  Package,
  ShoppingCart,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  Wrench,
  Loader2,
  ExternalLink
} from "lucide-react";
import { usePrinters } from "@/hooks/usePrinters";
import { usePrintJobs } from "@/hooks/usePrintJobs";
import { useWorklistTasks } from "@/hooks/useWorklistTasks";
import { useProductInventory } from "@/hooks/useProductInventory";
import { useMaterialInventory } from "@/hooks/useMaterialInventory";
import { useOrders } from "@/hooks/useOrders";
import { useDashboardWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils";
import PrintControlButtons from "@/components/PrintControlButtons";

const Index = () => {
  console.log('Index page component rendering');

  // Fetch real data using hooks
  const { printers, loading: printersLoading } = usePrinters();
  const { tenantId, session } = useAuth();
  const { data: liveData, isConnected: wsConnected } = useDashboardWebSocket(tenantId || '', session?.token || '');
  const { printJobs: jobs, loading: jobsLoading } = usePrintJobs();
  const { tasks, loading: tasksLoading } = useWorklistTasks();
  const { productInventory: inventory, loading: inventoryLoading } = useProductInventory();
  const { materials, loading: materialsLoading } = useMaterialInventory();
  const { orders, loading: ordersLoading } = useOrders();

  // Calculate Active Printers
  const activePrinters = useMemo(() => {
    // If WebSocket is connected, use live data; otherwise fallback to REST data
    if (wsConnected && liveData.length > 0) {
      // Count printers that are actively printing from live WebSocket data
      const active = liveData.filter(p => p.status === 'printing').length;
      const total = printers.length;
      const utilization = total > 0 ? Math.round((active / total) * 100) : 0;
      return { active, total, utilization };
    } else {
      // Fallback to REST API data
      const active = printers.filter(p => p.status === 'printing' || p.status === 'active').length;
      const total = printers.length;
      const utilization = total > 0 ? Math.round((active / total) * 100) : 0;
      return { active, total, utilization };
    }
  }, [printers, liveData, wsConnected]);

  // Calculate Jobs in Queue
  const queuedJobs = useMemo(() => {
    const queued = jobs.filter(j => j.status === 'pending' || j.status === 'queued');
    const totalHours = queued.reduce((sum, job) => {
      const duration = job.estimatedDuration || 60; // default 60 minutes if not set
      return sum + duration;
    }, 0) / 60; // Convert minutes to hours
    return { count: queued.length, hours: Math.round(totalHours) };
  }, [jobs]);

  // Get top 3 pending worklist tasks sorted by priority
  const topPendingTasks = useMemo(() => {
    const priorityOrder = { high: 1, medium: 2, low: 3 };
    return tasks
      .filter(t => t.status === 'pending' || t.status === 'in_progress')
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
      .slice(0, 3);
  }, [tasks]);

  // Get low stock finished goods
  const lowStockProducts = useMemo(() => {
    // Flatten all SKUs from all products
    const allSkus = inventory.flatMap(product =>
      product.skus.map(sku => ({
        ...sku,
        productName: product.productName,
        productId: product.productId,
        imageUrl: product.imageUrl
      }))
    );

    // Filter for low stock and sort by quantity (out of stock first, then lowest stock)
    return allSkus
      .filter(sku => {
        const threshold = sku.lowStockThreshold || 5;
        return sku.currentStock <= threshold;
      })
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 5);
  }, [inventory]);

  // Get low stock materials
  const lowStockMaterials = useMemo(() => {
    return materials
      .filter(m => m.status === 'low' || m.status === 'out_of_stock')
      .sort((a, b) => (a.remaining || 0) - (b.remaining || 0))
      .slice(0, 5);
  }, [materials]);

  // Calculate today's revenue
  const todayRevenue = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayOrders = orders.filter(o => {
      const orderDate = new Date(o.orderDate);
      return orderDate >= today;
    });

    const yesterdayOrders = orders.filter(o => {
      const orderDate = new Date(o.orderDate);
      return orderDate >= yesterday && orderDate < today;
    });

    const todayTotal = todayOrders.reduce((sum, o) => sum + (o.totalRevenue || 0), 0);
    const yesterdayTotal = yesterdayOrders.reduce((sum, o) => sum + (o.totalRevenue || 0), 0);

    const percentChange = yesterdayTotal > 0
      ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
      : 0;

    return { total: todayTotal, percentChange, isPositive: percentChange >= 0 };
  }, [orders]);

  // Get recent orders
  const recentOrders = useMemo(() => {
    return orders.slice(0, 5);
  }, [orders]);

  // Helper function to merge live WebSocket data with printer metadata
  const getPrinterWithLiveData = (printer: any) => {
    if (!wsConnected || !liveData || liveData.length === 0) {
      return printer; // Return original if WebSocket not available
    }

    const liveStatus = liveData.find(live => live.printer_id === printer.printerId?.toString());

    if (!liveStatus) {
      return printer; // No live data for this printer
    }

    // Infer connection status from status field
    // Backend sends "offline" for disconnected printers
    const isConnected = liveStatus.status !== 'offline';

    // Merge live data with printer metadata
    return {
      ...printer,
      status: liveStatus.status,
      isConnected: isConnected
    };
  };

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

  const getPrinterStatusIcon = (printer: any) => {
    if (!printer.isConnected) {
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
    switch (printer.status) {
      case 'printing':
      case 'active':
        return <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse" />;
      case 'idle':
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'maintenance':
        return <Wrench className="w-4 h-4 text-yellow-500" />;
      default:
        return <div className="w-4 h-4 bg-gray-400 rounded-full" />;
    }
  };

  const getPrinterStatusBadge = (printer: any) => {
    if (!printer.isConnected) {
      return <Badge variant="outline" className="text-gray-600 border-gray-200">Offline</Badge>;
    }
    switch (printer.status) {
      case 'printing':
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Printing</Badge>;
      case 'idle':
      case 'ready':
        return <Badge variant="secondary">Ready</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'maintenance':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-200">Maintenance</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getOrderStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-200">Pending</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800">Processing</Badge>;
      case 'fulfilled':
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Fulfilled</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
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
            {printersLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{activePrinters.active}/{activePrinters.total}</div>
                <p className="text-xs text-muted-foreground">{activePrinters.utilization}% utilization rate</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs in Queue</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{queuedJobs.count}</div>
                <p className="text-xs text-muted-foreground">
                  {queuedJobs.hours > 0 ? `~${queuedJobs.hours} hours remaining` : 'Queue empty'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className={`text-2xl font-bold ${lowStockProducts.length > 0 ? 'text-orange-600' : ''}`}>
                  {lowStockProducts.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  {lowStockProducts.length > 0 ? 'Need reordering' : 'All items stocked'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className={`text-2xl font-bold ${todayRevenue.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(todayRevenue.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {todayRevenue.percentChange !== 0
                    ? `${todayRevenue.isPositive ? '+' : ''}${todayRevenue.percentChange}% from yesterday`
                    : 'Same as yesterday'}
                </p>
              </>
            )}
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
          {tasksLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : topPendingTasks.length > 0 ? (
            <div className="space-y-4">
              {topPendingTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    {getTypeIcon(task.task_type)}
                    <div>
                      <h4 className="font-medium">{task.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {task.assigned_to && `${task.assigned_to} • `}
                        {task.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className={getPriorityColor(task.priority)}>
                      {task.priority.toUpperCase()}
                    </Badge>
                    {task.estimated_time_minutes && (
                      <Badge variant="outline" className="text-muted-foreground border-gray-200">
                        <Clock className="w-3 h-3 mr-1" />
                        {task.estimated_time_minutes} min
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No pending tasks</p>
          )}
        </CardContent>
      </Card>

      {/* Low Stock Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Low Stock Finished Goods</CardTitle>
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : lowStockProducts.length > 0 ? (
              <div className="space-y-4">
                {lowStockProducts.map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-sm text-muted-foreground">{item.sku} • {item.color}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{item.currentStock} units</p>
                      {item.currentStock === 0 ? (
                        <Badge variant="destructive">Out of Stock</Badge>
                      ) : (
                        <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">All items well stocked</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low Stock Materials</CardTitle>
          </CardHeader>
          <CardContent>
            {materialsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : lowStockMaterials.length > 0 ? (
              <div className="space-y-4">
                {lowStockMaterials.map((material) => (
                  <div key={material.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{material.type}</p>
                      <p className="text-sm text-muted-foreground">
                        {material.category === 'Filament'
                          ? `${material.brand || 'Unknown'} • ${material.color || ''}`
                          : `${material.brand || ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-[90px]">
                        {material.reorder_link && (
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => window.open(material.reorder_link, '_blank', 'noopener,noreferrer')}
                            title="Reorder this item"
                          >
                            Reorder
                          </Button>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">
                          {material.remaining} {material.category === 'Filament' ? 'g' : 'units'}
                        </p>
                        <Badge variant="outline" className="text-orange-600 border-orange-200">Low Stock</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">All materials well stocked</p>
            )}
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
            {printersLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : printers.length > 0 ? (
              <div className="space-y-4">
                {printers.slice(0, 5).map((printer) => {
                  const printerWithLiveData = getPrinterWithLiveData(printer);
                  return (
                    <div key={printer.id} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        {getPrinterStatusIcon(printerWithLiveData)}
                        <span className="truncate">{printer.name}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {getPrinterStatusBadge(printerWithLiveData)}
                        {printerWithLiveData.isConnected && (
                          <PrintControlButtons
                            printerId={printer.printerId?.toString() || printer.id.toString()}
                            status={printerWithLiveData.status}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No printers configured</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentOrders.length > 0 ? (
              <div className="space-y-4">
                {recentOrders.slice(0, 3).map((order) => (
                  <div key={order.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{order.orderNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {order.customerName} • {order.source}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(order.totalRevenue || 0)}</p>
                      {getOrderStatusBadge(order.status)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No orders yet</p>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default Index;
