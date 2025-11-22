import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOrders } from "@/hooks/useOrders";
import { ShoppingCart, DollarSign, Package, Eye, Calendar } from "lucide-react";
import OrderDetailsModal from "@/components/OrderDetailsModal";
import ShopifyConnectModal from "@/components/ShopifyConnectModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, subDays, isWithinInterval, parseISO } from "date-fns";
import { formatCurrency, formatNumber } from "@/lib/utils";

const OrdersPage = () => {
  const { orders, loading } = useOrders();
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isShopifyModalOpen, setIsShopifyModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | '7days' | '30days'>('all');
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const getFilteredOrders = () => {
    const now = new Date();
    
    switch (dateRange) {
      case '7days':
        return orders.filter(order => {
          const orderDate = parseISO(order.orderDate);
          return isWithinInterval(orderDate, {
            start: subDays(now, 7),
            end: now
          });
        });
      case '30days':
        return orders.filter(order => {
          const orderDate = parseISO(order.orderDate);
          return isWithinInterval(orderDate, {
            start: subDays(now, 30),
            end: now
          });
        });
      default:
        // Check if custom date range is set
        if (customDateRange.from && customDateRange.to) {
          return orders.filter(order => {
            const orderDate = parseISO(order.orderDate);
            return isWithinInterval(orderDate, {
              start: customDateRange.from!,
              end: customDateRange.to!
            });
          });
        }
        return orders;
    }
  };

  const filteredOrders = getFilteredOrders();
  const openOrders = filteredOrders.filter(order => order.status === 'Open');
  const totalOpenOrders = openOrders.length;
  
  const ordersBySource = (source: string) => {
    if (source === 'All') return filteredOrders;
    return filteredOrders.filter(order => order.platform.toLowerCase() === source.toLowerCase());
  };

  const calculateStats = (orderList: any[]) => {
    const totalRevenue = orderList.reduce((sum, order) => sum + order.totalRevenue, 0);
    const totalUnits = orderList.reduce((sum, order) => 
      sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
    );
    return { totalRevenue, totalUnits };
  };

  const handleViewOrder = (order: any) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleDateRangeChange = (value: string) => {
    setDateRange(value as 'all' | '7days' | '30days');
    // Reset custom date range when switching to preset ranges
    if (value !== 'all') {
      setCustomDateRange({ from: undefined, to: undefined });
    }
  };

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case '7days':
        return 'Last 7 Days';
      case '30days':
        return 'Last 30 Days';
      default:
        if (customDateRange.from && customDateRange.to) {
          return `${format(customDateRange.from, "MMM dd")} - ${format(customDateRange.to, "MMM dd")}`;
        }
        return 'All Time';
    }
  };

  const renderOrdersTable = (orders: any[]) => {
    const { totalRevenue, totalUnits } = calculateStats(orders);
    
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <div className="text-center p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
              <div className="text-sm text-muted-foreground">Total Revenue</div>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{formatNumber(totalUnits)}</div>
              <div className="text-sm text-muted-foreground">Total Units</div>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">
                    <button 
                      onClick={() => handleViewOrder(order)}
                      className="text-foreground hover:underline cursor-pointer"
                    >
                      {order.orderNumber}
                    </button>
                  </TableCell>
                  <TableCell>
                    {order.platform === 'Etsy' ? (
                      <Badge 
                        className="!bg-[#F1641E] !text-white !border-0 hover:!bg-[#F1641E]/80"
                      >
                        {order.platform}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{order.platform}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell>{new Date(order.orderDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge 
                      className={
                        order.status.toLowerCase() === 'completed' ? 'bg-green-500 text-white hover:bg-green-600' :
                        order.status.toLowerCase() === 'paid' ? 'bg-blue-900 text-white hover:bg-blue-800' :
                        order.status.toLowerCase() === 'pending' ? 'bg-yellow-500 text-white hover:bg-yellow-600' :
                        order.status.toLowerCase() === 'cancelled' ? 'bg-red-500 text-white hover:bg-red-600' :
                        'bg-muted text-muted-foreground'
                      }
                    >
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{formatCurrency(parseFloat(order.totalRevenue?.toString() || '0'))}</TableCell>
                  <TableCell>
                    <ul className="text-sm">
                      {order.items?.map(item => (
                        <li key={item.sku}>{item.sku} (x{item.quantity})</li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewOrder(order)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  const allOrdersStats = calculateStats(filteredOrders);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Orders</h1>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon">
                  <Calendar className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <CalendarComponent
                  mode="range"
                  selected={{
                    from: customDateRange.from,
                    to: customDateRange.to,
                  }}
                  onSelect={(range) => {
                    setCustomDateRange({
                      from: range?.from,
                      to: range?.to,
                    });
                    if (range?.from && range?.to) {
                      setDateRange('all'); // Set to 'all' to trigger custom filtering
                      setIsCalendarOpen(false);
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            
            <Select value={dateRange} onValueChange={handleDateRangeChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      <div className="text-sm text-muted-foreground">
        Showing data for: {getDateRangeLabel()}
      </div>
      
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Open Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalOpenOrders)}</div>
            <p className="text-xs text-muted-foreground">Across all sales channels</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(allOrdersStats.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">For selected period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Units Sold</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(allOrdersStats.totalUnits)}</div>
            <p className="text-xs text-muted-foreground">Total items shipped</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="All">
        <TabsList>
          <TabsTrigger value="All">All</TabsTrigger>
          <TabsTrigger value="Shopify">Shopify</TabsTrigger>
          <TabsTrigger value="Etsy">Etsy</TabsTrigger>
        </TabsList>
        <TabsContent value="All">{renderOrdersTable(ordersBySource('All'))}</TabsContent>
        <TabsContent value="Shopify">
          <div className="mb-4 flex justify-end">
            <Button
              onClick={() => setIsShopifyModalOpen(true)}
              className="bg-[#96bf48] hover:bg-[#7ea63a] text-white"
            >
              Connect Shopify
            </Button>
          </div>
          {renderOrdersTable(ordersBySource('Shopify'))}
        </TabsContent>
        <TabsContent value="Etsy">{renderOrdersTable(ordersBySource('Etsy'))}</TabsContent>
      </Tabs>

      <OrderDetailsModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      <ShopifyConnectModal
        isOpen={isShopifyModalOpen}
        onClose={() => setIsShopifyModalOpen(false)}
      />
    </div>
  );
};

export default OrdersPage;
